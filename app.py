import gzip
import io
import os
import random
import re
import string
import time
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from flask import Flask, request, render_template, make_response
from flask_restful import Api, Resource
from pymongo import MongoClient

load_dotenv()

FLASK_ENV = os.getenv("FLASK_ENV", "dev")
STATIC_BASE_URL = os.getenv("STATIC_BASE_URL", "/")
MAX_PASTE_SIZE = int(os.getenv("MAX_PASTE_SIZE", "10000"))
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


class SavePaste(Resource):
    def post(self):
        data = request.json.get("data", "")
        heading = request.json.get("heading", "My Paste").strip() or "My Paste"
        language = request.json.get("language", "plaintext").strip() or "plaintext"
        custom_key = request.json.get("custom_key", "").strip()
        user_ip = request.headers.get("X-Forwarded-For", request.remote_addr)

        if not data:
            return {"error": "No data provided"}, 400

        if len(data) > MAX_PASTE_SIZE:
            return {"error": f"Paste exceeds maximum size of {MAX_PASTE_SIZE} characters"}, 400

        if custom_key:
            if not re.match(r'^[a-zA-Z0-9_-]{4,20}$', custom_key):
                return {"error": "Custom key must be 4-20 characters (a-z, A-Z, 0-9, -, _)"}, 400
            if pastes_collection.find_one({"key": custom_key}):
                return {"error": "This custom key is already taken. Please choose another."}, 409
            key = custom_key
        else:
            key = generate_key()

        paste = {
            "key": key,
            "data": data,
            "heading": heading,
            "language": language,
            "created_at": int(time.time()),
            "ip_address": user_ip,
            "open_count": 0,
        }
        pastes_collection.insert_one(paste)
        return {"url": f"{request.host_url}{key}"}, 201


class GetPaste(Resource):
    def get(self, key):
        paste = pastes_collection.find_one({"key": key})
        if not paste:
            return {"error": "Paste not found or Deleted"}, 404
        pastes_collection.update_one({"key": key}, {"$inc": {"open_count": 1}})
        heading = paste.get("heading", "My Paste")
        language = paste.get("language", "plaintext")
        return make_response(
            render_template(
                "paste.html",
                paste=paste["data"],
                open_count=paste["open_count"],
                heading=heading,
                language=language,
            )
        )


class Index(Resource):
    def get(self):
        return make_response(render_template("index.html"))


api.add_resource(SavePaste, "/api/save")
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
