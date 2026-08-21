import base64
import gzip
import hashlib
import hmac
import io
import logging
import os
import random
import re
import secrets
import string
import time
from datetime import timedelta
from functools import wraps

from apscheduler.schedulers.background import BackgroundScheduler
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from flask import Flask, request, render_template, make_response, session, redirect, url_for, jsonify
from flask_restful import Api, Resource
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError, PyMongoError
from werkzeug.security import generate_password_hash, check_password_hash

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

FLASK_ENV = os.getenv("FLASK_ENV", "dev")
# When true, templates use STATIC_BASE_URL (S3/CloudFront) and Flask does not serve public/.
# When false, Flask serves public/ and templates use relative paths (/css/...).
USE_CDN_STATIC = os.getenv("USE_CDN_STATIC", "false").lower() == "true"
STATIC_BASE_URL = os.getenv("STATIC_BASE_URL", "").rstrip("/")
MAX_PASTE_SIZE = int(os.getenv('MAX_PASTE_SIZE', '10000'))
ENCRYPTION_KEY = os.getenv('ENCRYPTION_KEY', '').strip()
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'admin')
ALLOWED_LANGUAGES = {
    'auto', 'plaintext', 'python', 'javascript', 'typescript', 'html', 'css',
    'json', 'bash', 'c', 'cpp', 'csharp', 'java', 'go', 'rust', 'sql',
    'yaml', 'xml', 'markdown', 'php', 'ruby', 'kotlin', 'swift', 'lua',
    'perl', 'dockerfile', 'nginx'
}
IP_REGEX = re.compile(r'^\d{1,3}(\.\d{1,3}){3}$|^[a-fA-F0-9:]+$')

app: Flask = None

if USE_CDN_STATIC:
    if not STATIC_BASE_URL:
        logger.warning(
            "USE_CDN_STATIC=true but STATIC_BASE_URL is empty — "
            "static asset URLs will be broken"
        )
    logger.info(
        "CDN static mode | env=%s static_base_url=%s",
        FLASK_ENV, STATIC_BASE_URL or "(empty)",
    )
    app = Flask(__name__, static_folder=None)
else:
    logger.info(
        "Local static mode | env=%s (Flask serves public/)",
        FLASK_ENV,
    )
    app = Flask(__name__, static_folder="public", static_url_path="/")

_secret = os.getenv("SECRET_KEY", "")
if not _secret or _secret == "super_secret_key":
    if FLASK_ENV == "prod":
        raise RuntimeError("SECRET_KEY must be set to a strong random value in production")
    logger.warning("Using generated SECRET_KEY (not recommended for production)")
    _secret = secrets.token_hex(32)
app.secret_key = _secret

app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
if FLASK_ENV == "prod":
    app.config['SESSION_COOKIE_SECURE'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=8)
app.config['MAX_CONTENT_LENGTH'] = MAX_PASTE_SIZE * 4

api = Api(app)
scheduler = BackgroundScheduler()


@app.context_processor
def inject_static_base_url():
    if USE_CDN_STATIC:
        return {"static_base_url": STATIC_BASE_URL}
    # Empty prefix → templates resolve to /css/..., /js/..., /img/...
    return {"static_base_url": ""}


@app.after_request
def after_request(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    if FLASK_ENV == "prod":
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'

    accept_encoding = request.headers.get("Accept-Encoding", "")
    if "gzip" not in accept_encoding.lower():
        return response
    ct = response.content_type or ""
    if "text/html" not in ct and "application/json" not in ct:
        return response
    content = response.get_data()
    if len(content) < 500:
        return response
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6) as gf:
        gf.write(content)
    response.set_data(buf.getvalue())
    response.headers["Content-Encoding"] = "gzip"
    response.headers["Content-Length"] = str(len(response.get_data()))
    response.headers["Vary"] = "Accept-Encoding"
    return response


@app.errorhandler(PyMongoError)
def handle_db_error(e):
    logger.error(f"Database error: {e}")
    return jsonify({"error": "Database unavailable"}), 503


@app.errorhandler(413)
def handle_too_large(e):
    return jsonify({"error": f"Request too large. Max paste size is {MAX_PASTE_SIZE} characters"}), 413


MONGO_CONNECTION_STRING = os.getenv("MONGO_CONNECTION_STRING", "mongodb://localhost:27017")
if not MONGO_CONNECTION_STRING:
    raise ValueError("MONGO_CONNECTION_STRING is not set in the environment variables")

client = MongoClient(
    MONGO_CONNECTION_STRING,
    maxPoolSize=10,
    minPoolSize=2,
    serverSelectionTimeoutMS=5000
)
db = client[os.getenv("MONGO_DB_NAME", "pastebin")]
pastes_collection = db[os.getenv("MONGO_COLLECTION_NAME", "pastes")]


def _ensure_indexes():
    try:
        pastes_collection.create_index("key", unique=True, background=True)
        pastes_collection.create_index([("created_at", DESCENDING)], background=True)
        pastes_collection.create_index([("open_count", DESCENDING)], background=True)
        pastes_collection.create_index([("created_at", ASCENDING), ("open_count", ASCENDING)], background=True)
        logger.info("MongoDB indexes ensured")
    except PyMongoError as e:
        logger.error(f"Failed to create indexes: {e}")


def _get_user_ip():
    xff = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    if xff and IP_REGEX.match(xff):
        return xff
    return request.remote_addr or "unknown"


def generate_key():
    key_length = int(os.getenv("KEY_LENGTH", "6"))
    chars = string.ascii_letters + string.digits
    max_retries = 10
    for _ in range(max_retries):
        key = "".join(random.choices(chars, k=key_length))
        try:
            pastes_collection.insert_one({'_id': key, 'key': key, '_temp': True})
            pastes_collection.delete_one({'_id': key, '_temp': True})
            return key
        except DuplicateKeyError:
            continue
    raise RuntimeError("Failed to generate a unique key after maximum retries")


def format_expiry(expires_at):
    if not expires_at:
        return None
    remaining = expires_at - int(time.time())
    if remaining <= 0:
        return None
    if remaining < 60:
        s = max(1, remaining)
        return f"Expires in {s} sec" if s == 1 else f"Expires in {s} secs"
    mins = remaining // 60
    if mins < 60:
        return f"Expires in {mins} min" if mins == 1 else f"Expires in {mins} mins"
    hours = mins // 60
    if hours < 24:
        return f"Expires in {hours} hour" if hours == 1 else f"Expires in {hours} hours"
    days = hours // 24
    if days < 7:
        return f"Expires in {days} day" if days == 1 else f"Expires in {days} days"
    weeks = days // 7
    if weeks < 5:
        return f"Expires in {weeks} week" if weeks == 1 else f"Expires in {weeks} weeks"
    months = days // 30
    return f"Expires in {months} month" if months == 1 else f"Expires in {months} months"


_fernet_cache = {}


def _derive_fernet_key(secret):
    digest = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def _get_fernet(key):
    if key not in _fernet_cache:
        _fernet_cache[key] = Fernet(key)
    return _fernet_cache[key]


def _get_encryption_key():
    if ENCRYPTION_KEY:
        return _derive_fernet_key(ENCRYPTION_KEY)
    return None


def _encrypt(plaintext, key):
    return _get_fernet(key).encrypt(plaintext.encode()).decode()


def _decrypt(ciphertext, key):
    return _get_fernet(key).decrypt(ciphertext.encode()).decode()


class SavePaste(Resource):
    def post(self):
        json_data = request.get_json(silent=True) or {}
        data = json_data.get("data", "")
        heading = (json_data.get("heading", "My Paste") or "My Paste").strip()[:200] or "My Paste"
        language = (json_data.get("language", "plaintext") or "plaintext").strip()
        if language not in ALLOWED_LANGUAGES:
            language = "plaintext"
        custom_key = (json_data.get("custom_key", "") or "").strip()
        password = (json_data.get("password", "") or "").strip()
        expiry_value = json_data.get("expiry_value")
        expiry_unit = json_data.get("expiry_unit")
        view_once = json_data.get("view_once", False)
        max_views = json_data.get("max_views")
        user_ip = _get_user_ip()

        if not data:
            return {"error": "No data provided"}, 400

        if len(data) > MAX_PASTE_SIZE:
            return {"error": f"Paste exceeds maximum size of {MAX_PASTE_SIZE} characters"}, 400

        if password:
            if " " in password:
                return {"error": "Password must not contain spaces"}, 400
            if len(password) > 128:
                return {"error": "Password must be 128 characters or fewer"}, 400

        if custom_key:
            if ' ' in custom_key:
                return {'error': 'Custom key must not contain spaces'}, 400
            if not re.match(r'^[a-zA-Z0-9_-]{4,20}$', custom_key):
                return {'error': 'Custom key must be 4-20 characters (a-z, A-Z, 0-9, -, _)'}, 400
            if pastes_collection.find_one({'key': custom_key}):
                return {'error': 'This custom key is already taken. Please choose another.'}, 409
            key = custom_key
        else:
            key = generate_key()

        encrypted_data = data
        if password:
            pw_key = _derive_fernet_key(password)
            encrypted_data = _encrypt(data, pw_key)
        elif ENCRYPTION_KEY:
            encrypted_data = _encrypt(data, _get_encryption_key())

        paste = {
            'key': key,
            'data': encrypted_data,
            'heading': heading,
            'language': language,
            'created_at': int(time.time()),
            'ip_address': user_ip,
            'open_count': 0,
        }
        if password:
            paste['password_hash'] = generate_password_hash(password)
            paste['encrypted_with'] = 'password'
        elif ENCRYPTION_KEY:
            paste['encrypted_with'] = 'server'

        if view_once:
            paste["view_once"] = True

        if max_views:
            try:
                mv = int(max_views)
                if mv < 1:
                    return {"error": "Max views must be at least 1"}, 400
                if mv > 1000:
                    return {"error": "Max views cannot exceed 1000"}, 400
                paste["max_views"] = mv
            except (ValueError, TypeError):
                return {"error": "Invalid max views value"}, 400

        if expiry_value and expiry_unit:
            try:
                val = int(expiry_value)
                if val < 1:
                    return {"error": "Expiry value must be at least 1"}, 400
                unit_map = {
                    "seconds": 1,
                    "minutes": 60,
                    "hours": 3600,
                    "days": 86400,
                    "weeks": 604800,
                    "months": 2592000,
                }
                if expiry_unit not in unit_map:
                    return {"error": "Invalid expiry unit"}, 400
                max_vals = {"seconds": 86400, "minutes": 1440, "hours": 720, "days": 365, "weeks": 52, "months": 12}
                if val > max_vals.get(expiry_unit, 9999):
                    return {"error": f"Max expiry is {max_vals[expiry_unit]} {expiry_unit}"}, 400
                paste["expires_at"] = int(time.time()) + val * unit_map[expiry_unit]
            except (ValueError, TypeError):
                return {"error": "Invalid expiry value"}, 400

        try:
            pastes_collection.insert_one(paste)
        except DuplicateKeyError:
            return {"error": "Key collision occurred, please try again"}, 409
        return {"url": f"{request.host_url}{key}"}, 201


class GetPaste(Resource):
    def get(self, key):
        if key in ('admin', 'api', 'health'):
            return make_response(render_template("paste.html", paste="", paste_key=key, paste_not_found=True, heading="", language="", open_count=0, password_required=False, expires_text=None, view_once=False))

        paste = pastes_collection.find_one({"key": key})

        if not paste:
            return make_response(
                render_template("paste.html", paste="", paste_key=key, paste_not_found=True, heading="", language="", open_count=0, password_required=False, expires_text=None, view_once=False)
            )

        now = int(time.time())
        if "expires_at" in paste and paste["expires_at"] and paste["expires_at"] < now:
            pastes_collection.delete_one({"key": key})
            return make_response(
                render_template("paste.html", paste="", paste_key=key, paste_not_found=True, heading="", language="", open_count=0, password_required=False, expires_text=None, view_once=False)
            )

        if paste.get("view_once") and paste.get("open_count", 0) > 0:
            pastes_collection.delete_one({"key": key})
            return make_response(
                render_template("paste.html", paste="", paste_key=key, paste_not_found=True, heading="", language="", open_count=0, password_required=False, expires_text=None, view_once=False)
            )

        if "max_views" in paste and paste.get("open_count", 0) >= paste["max_views"]:
            pastes_collection.delete_one({"key": key})
            return make_response(
                render_template("paste.html", paste="", paste_key=key, paste_not_found=True, heading="", language="", open_count=0, password_required=False, expires_text=None, view_once=False)
            )

        heading = paste.get("heading", "My Paste")
        language = paste.get("language", "plaintext")
        expires_text = format_expiry(paste.get("expires_at"))
        is_view_once = paste.get("view_once", False)
        skip_increment = request.args.get("new") == "1"

        if "password_hash" in paste:
            return make_response(
                render_template("paste.html", paste="", open_count=paste.get("open_count", 0), heading=heading, language=language, password_required=True, paste_key=paste["key"], expires_text=expires_text, view_once=is_view_once, paste_not_found=False)
            )

        if not skip_increment:
            pastes_collection.update_one({'key': key}, {'$inc': {'open_count': 1}})

        paste_data = paste['data']
        encrypted_with = paste.get('encrypted_with')
        if encrypted_with == 'server':
            try:
                paste_data = _decrypt(paste_data, _get_encryption_key())
            except Exception:
                paste_data = '[Decryption failed]'

        return make_response(
            render_template('paste.html', paste=paste_data, open_count=paste.get('open_count', 0), heading=heading, language=language, password_required=False, paste_key=paste['key'], expires_text=expires_text, view_once=is_view_once, paste_not_found=False)
        )


class AccessPaste(Resource):
    def post(self, key):
        paste = pastes_collection.find_one({"key": key})
        if not paste:
            return {"error": "Paste not found"}, 404

        now = int(time.time())
        if "expires_at" in paste and paste["expires_at"] and paste["expires_at"] < now:
            pastes_collection.delete_one({"key": key})
            return {"error": "Paste not found"}, 404

        if paste.get("view_once") and paste.get("open_count", 0) > 0:
            pastes_collection.delete_one({"key": key})
            return {"error": "Paste not found"}, 404

        if "max_views" in paste and paste.get("open_count", 0) >= paste["max_views"]:
            pastes_collection.delete_one({"key": key})
            return {"error": "Paste not found"}, 404

        if "password_hash" not in paste:
            pastes_collection.update_one({"key": key}, {"$inc": {"open_count": 1}})
            paste_data = paste["data"]
            if paste.get('encrypted_with') == 'server':
                try:
                    paste_data = _decrypt(paste_data, _get_encryption_key())
                except Exception:
                    paste_data = '[Decryption failed]'
            return {
                "ok": True,
                "paste": paste_data,
                "heading": paste.get("heading", "My Paste"),
                "language": paste.get("language", "plaintext"),
            }

        json_data = request.get_json(silent=True) or {}
        password = (json_data.get("password", "") or "").strip()
        if not check_password_hash(paste["password_hash"], password):
            return {"error": "Incorrect password"}, 403

        pastes_collection.update_one({"key": key}, {"$inc": {"open_count": 1}})
        paste_data = paste["data"]
        if paste.get('encrypted_with') == 'password':
            pw_key = _derive_fernet_key(password)
            try:
                paste_data = _decrypt(paste_data, pw_key)
            except Exception:
                paste_data = '[Decryption failed]'
        return {
            "ok": True,
            "paste": paste_data,
            "heading": paste.get("heading", "My Paste"),
            "language": paste.get("language", "plaintext"),
        }


class Index(Resource):
    def get(self):
        return make_response(render_template("index.html"))


@app.route('/health')
def health():
    try:
        client.admin.command('ping')
        return jsonify({
            "status": "healthy",
            "environment": FLASK_ENV,
            "use_cdn_static": USE_CDN_STATIC,
        }), 200
    except Exception:
        return jsonify({"status": "unhealthy"}), 503


def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('admin_logged_in'):
            if request.path.startswith('/api/'):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated_function


@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if session.get('admin_logged_in'):
        return redirect(url_for('admin_dashboard'))

    error = None
    if request.method == 'POST':
        username = (request.form.get('username', '') or '').strip()
        password = (request.form.get('password', '') or '').strip()
        if hmac.compare_digest(username, ADMIN_USERNAME) and hmac.compare_digest(password, ADMIN_PASSWORD):
            session.clear()
            session['admin_logged_in'] = True
            session['admin_username'] = username
            session.permanent = True
            logger.info(f"Admin login successful from {_get_user_ip()}")
            return redirect(url_for('admin_dashboard'))
        else:
            logger.warning(f"Failed admin login attempt from {_get_user_ip()}")
            error = 'Invalid credentials'

    return make_response(render_template('admin_login.html', error=error))


@app.route('/admin/logout', methods=['POST'])
def admin_logout():
    logger.info(f"Admin logout from {_get_user_ip()}")
    session.clear()
    return redirect(url_for('admin_login'))


@app.route('/admin')
@admin_required
def admin_dashboard():
    return make_response(render_template('admin.html', username=session.get('admin_username', 'admin')))


@app.route('/api/admin/pastes')
@admin_required
def api_admin_pastes():
    page = max(1, request.args.get('page', 1, type=int))
    per_page = max(1, min(request.args.get('per_page', 20, type=int), 100))
    search = (request.args.get('search', '') or '').strip()
    sort_by = request.args.get('sort_by', 'created_at')
    sort_order = request.args.get('sort_order', 'desc')
    language_filter = (request.args.get('language', '') or '').strip()
    encrypted_filter = (request.args.get('encrypted', '') or '').strip()

    query = {}

    if search:
        safe_search = re.escape(search)
        query['$or'] = [
            {'key': {'$regex': safe_search, '$options': 'i'}},
            {'heading': {'$regex': safe_search, '$options': 'i'}},
            {'ip_address': {'$regex': safe_search, '$options': 'i'}}
        ]

    if language_filter and language_filter in ALLOWED_LANGUAGES:
        query['language'] = language_filter

    if encrypted_filter == 'server':
        query['encrypted_with'] = 'server'
    elif encrypted_filter == 'password':
        query['encrypted_with'] = 'password'
    elif encrypted_filter == 'none':
        query['encrypted_with'] = {'$exists': False}

    total = pastes_collection.count_documents(query)

    valid_sort_fields = {'created_at', 'open_count', 'key', 'heading', 'language'}
    if sort_by not in valid_sort_fields:
        sort_by = 'created_at'
    sort_direction = -1 if sort_order == 'desc' else 1

    skips = (page - 1) * per_page
    pastes = list(pastes_collection.find(query).sort(sort_by, sort_direction).skip(skips).limit(per_page))

    paste_list = []
    for i, paste in enumerate(pastes):
        paste_list.append({
            'index': skips + i + 1,
            'key': paste.get('key', ''),
            'heading': paste.get('heading', 'My Paste'),
            'language': paste.get('language', 'plaintext'),
            'created_at': paste.get('created_at', 0),
            'ip_address': paste.get('ip_address', ''),
            'open_count': paste.get('open_count', 0),
            'encrypted_with': paste.get('encrypted_with', None),
            'password_hash': 'password_hash' in paste,
            'expires_at': paste.get('expires_at', None),
            'view_once': paste.get('view_once', False),
            'max_views': paste.get('max_views', None),
            'data_length': len(paste.get('data', ''))
        })

    total_pages = max(1, (total + per_page - 1) // per_page)

    return jsonify({
        'pastes': paste_list,
        'total': total,
        'page': page,
        'per_page': per_page,
        'total_pages': total_pages
    })


@app.route('/api/admin/paste/<string:key>')
@admin_required
def api_admin_paste_detail(key):
    paste = pastes_collection.find_one({"key": key})
    if not paste:
        return jsonify({'error': 'Paste not found'}), 404

    paste_data = paste.get('data', '')
    encrypted_with = paste.get('encrypted_with')

    if encrypted_with == 'server':
        try:
            paste_data = _decrypt(paste_data, _get_encryption_key())
        except Exception:
            paste_data = '[Decryption failed]'
    elif encrypted_with == 'password':
        paste_data = '[Password protected]'

    return jsonify({
        'key': paste.get('key', ''),
        'heading': paste.get('heading', 'My Paste'),
        'language': paste.get('language', 'plaintext'),
        'created_at': paste.get('created_at', 0),
        'ip_address': paste.get('ip_address', ''),
        'open_count': paste.get('open_count', 0),
        'encrypted_with': encrypted_with,
        'password_hash': 'password_hash' in paste,
        'expires_at': paste.get('expires_at', None),
        'view_once': paste.get('view_once', False),
        'max_views': paste.get('max_views', None),
        'data': paste_data,
        'data_length': len(paste.get('data', ''))
    })


@app.route('/api/admin/paste/<string:key>', methods=['DELETE'])
@admin_required
def api_admin_delete_paste(key):
    result = pastes_collection.delete_one({"key": key})
    if result.deleted_count == 0:
        return jsonify({'error': 'Paste not found'}), 404
    logger.info(f"Admin deleted paste {key}")
    return jsonify({'ok': True, 'message': f'Paste {key} deleted'})


@app.route('/api/admin/delete-expired', methods=['DELETE'])
@admin_required
def api_admin_delete_expired():
    now = int(time.time())
    expired_by_time = pastes_collection.delete_many({'expires_at': {'$exists': True, '$ne': None, '$lt': now}})
    expired_view_once = pastes_collection.delete_many({'view_once': True, 'open_count': {'$gte': 1}})
    max_views_pastes = pastes_collection.find({
        'max_views': {'$exists': True, '$ne': None},
        '$expr': {'$lte': ['$max_views', '$open_count']}
    })
    max_views_keys = [p['key'] for p in max_views_pastes]
    expired_max_views = 0
    if max_views_keys:
        result = pastes_collection.delete_many({'key': {'$in': max_views_keys}})
        expired_max_views = result.deleted_count
    total_deleted = expired_by_time.deleted_count + expired_view_once.deleted_count + expired_max_views
    logger.info(f"Admin deleted {total_deleted} expired pastes")
    return jsonify({'ok': True, 'deleted': total_deleted, 'message': f'Deleted {total_deleted} expired pastes'})


@app.route('/api/admin/analytics')
@admin_required
def api_admin_analytics():
    total_pastes = pastes_collection.count_documents({})

    pipeline = [
        {'$group': {'_id': '$language', 'count': {'$sum': 1}}},
        {'$sort': {'count': -1}},
        {'$limit': 10}
    ]
    language_stats = list(pastes_collection.aggregate(pipeline))

    pipeline = [
        {'$group': {'_id': '$encrypted_with', 'count': {'$sum': 1}}}
    ]
    encryption_stats = list(pastes_collection.aggregate(pipeline))

    pipeline = [
        {'$group': {'_id': None, 'total_views': {'$sum': '$open_count'}}}
    ]
    total_views_result = list(pastes_collection.aggregate(pipeline))
    total_views = total_views_result[0]['total_views'] if total_views_result else 0

    pipeline = [
        {'$group': {'_id': None, 'avg_views': {'$avg': '$open_count'}}}
    ]
    avg_views_result = list(pastes_collection.aggregate(pipeline))
    avg_views = round(avg_views_result[0]['avg_views'], 2) if avg_views_result else 0

    now = int(time.time())
    pastes_last_day = pastes_collection.count_documents({'created_at': {'$gte': now - 86400}})
    pastes_last_week = pastes_collection.count_documents({'created_at': {'$gte': now - 604800}})
    pastes_last_month = pastes_collection.count_documents({'created_at': {'$gte': now - 2592000}})

    password_protected = pastes_collection.count_documents({'password_hash': {'$exists': True}})
    view_once_pastes = pastes_collection.count_documents({'view_once': True})
    encrypted_pastes = pastes_collection.count_documents({'encrypted_with': {'$exists': True}})

    return jsonify({
        'total_pastes': total_pastes,
        'total_views': total_views,
        'avg_views': avg_views,
        'pastes_last_day': pastes_last_day,
        'pastes_last_week': pastes_last_week,
        'pastes_last_month': pastes_last_month,
        'password_protected': password_protected,
        'view_once_pastes': view_once_pastes,
        'encrypted_pastes': encrypted_pastes,
        'language_stats': [{'language': s['_id'] or 'unknown', 'count': s['count']} for s in language_stats],
        'encryption_stats': encryption_stats,
    })


api.add_resource(SavePaste, "/api/save")
api.add_resource(AccessPaste, "/api/access/<string:key>")
api.add_resource(GetPaste, "/<string:key>")
api.add_resource(Index, "/")


def delete_pastes():
    logger.info(f"Running scheduled cleanup at {datetime.now()}")
    threshold = int(time.time()) - (7 * 24 * 3600)
    result = pastes_collection.delete_many({"open_count": {"$lt": 2}, "created_at": {"$lt": threshold}})
    logger.info(f"Deleted {result.deleted_count} old low-view pastes")

    now = int(time.time())
    expired = pastes_collection.delete_many({'expires_at': {'$exists': True, '$ne': None, '$lt': now}})
    logger.info(f"Deleted {expired.deleted_count} expired pastes")

    viewed = pastes_collection.delete_many({'view_once': True, 'open_count': {'$gte': 1}})
    logger.info(f"Deleted {viewed.deleted_count} viewed-once pastes")


scheduler.add_job(delete_pastes, "interval", days=7)

if FLASK_ENV != "prod":
    _ensure_indexes()
else:
    try:
        _ensure_indexes()
    except Exception as e:
        logger.error(f"Index creation failed: {e}")

if __name__ == "__main__":
    scheduler.start()
    app.run(
        debug=os.getenv("FLASK_DEBUG", "False").lower() == "true" and FLASK_ENV != "prod",
        port=int(os.getenv("FLASK_PORT", "5000")),
        threaded=True,
        host=os.getenv("FLASK_HOST", "0.0.0.0"),
    )
else:
    scheduler.start()
