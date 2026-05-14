import base64
import gzip
import hashlib
import io
import os
import random
import re
import string
import time
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from flask import Flask, request, render_template, make_response
from flask_restful import Api, Resource
from pymongo import MongoClient
from werkzeug.security import generate_password_hash, check_password_hash

load_dotenv()

FLASK_ENV = os.getenv("FLASK_ENV", "dev")
STATIC_BASE_URL = os.getenv("STATIC_BASE_URL", "/")
MAX_PASTE_SIZE = int(os.getenv('MAX_PASTE_SIZE', '10000'))
ENCRYPTION_KEY = os.getenv('ENCRYPTION_KEY', '').strip()
app: Flask = None

if FLASK_ENV == "prod":
    print("Running in PRODUCTION environment")
    app = Flask(__name__, static_folder=None)
else:
    print("Running in DEVELOPMENT environment")
    app = Flask(__name__, static_folder="public", static_url_path="/")

app.secret_key = os.getenv("SECRET_KEY", "super_secret_key")
api = Api(app)
scheduler = BackgroundScheduler()


@app.context_processor
def inject_static_base_url():
    if FLASK_ENV == "prod":
        return {"static_base_url": STATIC_BASE_URL}
    else:
        base_url = f"{request.scheme}://{request.host}"
        return {"static_base_url": base_url}


@app.after_request
def gzip_response(response):
    accept_encoding = request.headers.get("Accept-Encoding", "")
    if "gzip" not in accept_encoding.lower():
        return response
    if response.content_type and "text/html" not in response.content_type and "application/json" not in response.content_type:
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


MONGO_CONNECTION_STRING = os.getenv("MONGO_CONNECTION_STRING", "mongodb://localhost:27017")
if not MONGO_CONNECTION_STRING:
    raise ValueError("MONGO_CONNECTION_STRING is not set in the environment variables")

client = MongoClient(MONGO_CONNECTION_STRING)
db = client[os.getenv("MONGO_DB_NAME", "pastebin")]
pastes_collection = db[os.getenv("MONGO_COLLECTION_NAME", "pastes")]


def generate_key():
    key_length = int(os.getenv("KEY_LENGTH", "6"))
    chars = string.ascii_letters + string.digits
    while True:
        key = "".join(random.choices(chars, k=key_length))
        if not pastes_collection.find_one({"key": key}):
            return key


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


def _derive_fernet_key(secret):
    digest = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def _get_encryption_key():
    if ENCRYPTION_KEY:
        return _derive_fernet_key(ENCRYPTION_KEY)
    return None


def _encrypt(plaintext, key):
    return Fernet(key).encrypt(plaintext.encode()).decode()


def _decrypt(ciphertext, key):
    return Fernet(key).decrypt(ciphertext.encode()).decode()


class SavePaste(Resource):
    def post(self):
        data = request.json.get("data", "")
        heading = request.json.get("heading", "My Paste").strip() or "My Paste"
        language = request.json.get("language", "plaintext").strip() or "plaintext"
        custom_key = request.json.get("custom_key", "").strip()
        password = request.json.get("password", "").strip()
        expiry_value = request.json.get("expiry_value")
        expiry_unit = request.json.get("expiry_unit")
        view_once = request.json.get("view_once", False)
        max_views = request.json.get("max_views")
        user_ip = request.headers.get("X-Forwarded-For", request.remote_addr)

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

        pastes_collection.insert_one(paste)
        return {"url": f"{request.host_url}{key}"}, 201


class GetPaste(Resource):
    def get(self, key):
        paste = pastes_collection.find_one({"key": key})

        if not paste:
            return make_response(
                render_template(
                    "paste.html",
                    paste="",
                    paste_key=key,
                    paste_not_found=True,
                    heading="",
                    language="",
                    open_count=0,
                    password_required=False,
                    expires_text=None,
                    view_once=False,
                )
            )

        if "expires_at" in paste and paste["expires_at"] < int(time.time()):
            pastes_collection.delete_one({"key": key})
            return make_response(
                render_template(
                    "paste.html",
                    paste="",
                    paste_key=key,
                    paste_not_found=True,
                    heading="",
                    language="",
                    open_count=0,
                    password_required=False,
                    expires_text=None,
                    view_once=False,
                )
            )

        if paste.get("view_once") and paste.get("open_count", 0) > 0:
            pastes_collection.delete_one({"key": key})
            return make_response(
                render_template(
                    "paste.html",
                    paste="",
                    paste_key=key,
                    paste_not_found=True,
                    heading="",
                    language="",
                    open_count=0,
                    password_required=False,
                    expires_text=None,
                    view_once=False,
                )
            )

        if "max_views" in paste and paste.get("open_count", 0) >= paste["max_views"]:
            pastes_collection.delete_one({"key": key})
            return make_response(
                render_template(
                    "paste.html",
                    paste="",
                    paste_key=key,
                    paste_not_found=True,
                    heading="",
                    language="",
                    open_count=0,
                    password_required=False,
                    expires_text=None,
                    view_once=False,
                )
            )

        heading = paste.get("heading", "My Paste")
        language = paste.get("language", "plaintext")
        expires_text = format_expiry(paste.get("expires_at"))
        is_view_once = paste.get("view_once", False)
        skip_increment = request.args.get("new") == "1"

        if "password_hash" in paste:
            return make_response(
                render_template(
                    "paste.html",
                    paste="",
                    open_count=paste.get("open_count", 0),
                    heading=heading,
                    language=language,
                    password_required=True,
                    paste_key=paste["key"],
                    expires_text=expires_text,
                    view_once=is_view_once,
                    paste_not_found=False,
                )
            )

        if not skip_increment:
            pastes_collection.update_one({'key': key}, {'$inc': {'open_count': 1}})

        paste_data = paste['data']
        encrypted_with = paste.get('encrypted_with')
        if encrypted_with == 'server':
            paste_data = _decrypt(paste_data, _get_encryption_key())
        elif encrypted_with is None:
            pass

        return make_response(
            render_template(
                'paste.html',
                paste=paste_data,
                open_count=paste.get('open_count', 0),
                heading=heading,
                language=language,
                password_required=False,
                paste_key=paste['key'],
                expires_text=expires_text,
                view_once=is_view_once,
                paste_not_found=False,
            )
        )


class AccessPaste(Resource):
    def post(self, key):
        paste = pastes_collection.find_one({"key": key})
        if not paste:
            return {"error": "Paste not found"}, 404

        if "expires_at" in paste and paste["expires_at"] < int(time.time()):
            pastes_collection.delete_one({"key": key})
            return {"error": "Paste not found"}, 404

        if paste.get("view_once") and paste.get("open_count", 0) > 0:
            pastes_collection.delete_one({"key": key})
            return {"error": "Paste not found"}, 404

        if "max_views" in paste and paste.get("open_count", 0) >= paste["max_views"]:
            pastes_collection.delete_one({"key": key})
            return {"error": "Paste not found"}, 404

        if "password_hash" not in paste:
            if not paste.get("view_once"):
                pastes_collection.update_one({"key": key}, {"$inc": {"open_count": 1}})
            paste_data = paste["data"]
            if paste.get('encrypted_with') == 'server':
                paste_data = _decrypt(paste_data, _get_encryption_key())
            return {
                "ok": True,
                "paste": paste_data,
                "heading": paste.get("heading", "My Paste"),
                "language": paste.get("language", "plaintext"),
            }

        password = request.json.get("password", "")
        if not check_password_hash(paste["password_hash"], password):
            return {"error": "Incorrect password"}, 403

        pastes_collection.update_one({"key": key}, {"$inc": {"open_count": 1}})
        paste_data = paste["data"]
        if paste.get('encrypted_with') == 'password':
            pw_key = _derive_fernet_key(password)
            paste_data = _decrypt(paste_data, pw_key)
        return {
            "ok": True,
            "paste": paste_data,
            "heading": paste.get("heading", "My Paste"),
            "language": paste.get("language", "plaintext"),
        }


class Index(Resource):
    def get(self):
        return make_response(render_template("index.html"))


api.add_resource(SavePaste, "/api/save")
api.add_resource(AccessPaste, "/api/access/<string:key>")
api.add_resource(GetPaste, "/<string:key>")
api.add_resource(Index, "/")


def delete_pastes():
    threshold = int(time.time()) - (7 * 24 * 3600)
    print(f"Running delete_pastes at {datetime.now()}")
    result = pastes_collection.delete_many(
        {"open_count": {"$lt": 2}, "created_at": {"$lt": threshold}}
    )
    print(f"Deleted {result.deleted_count} old pastes")


scheduler.add_job(delete_pastes, "interval", days=7)

if __name__ == "__main__":
    scheduler.start()
    app.run(
        debug=os.getenv("FLASK_DEBUG", "False").lower() == "true",
        port=int(os.getenv("FLASK_PORT", "5000")),
        threaded=True,
        host=os.getenv("FLASK_HOST", "0.0.0.0"),
    )
