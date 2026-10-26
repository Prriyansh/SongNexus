"""
Song Comparison API (Flask).

  GET /api/stats                      dataset size and cross dataset match rate
  GET /api/search?q=text              find songs by title or artist
  GET /api/compare?a=ID&b=ID          full side by side comparison
  GET /api/similar/ID?k=10            songs that sound most like this one
"""
import math
import os
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from catalog import Catalog
import similarity

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


class BadRequest(Exception):
    """A query parameter the API can't use; answered as a JSON 400."""


def int_arg(name, default, lo, hi):
    """Whole-number query parameter, clamped to lo..hi (so ?k=-1 can't scan the whole catalog)."""
    raw = request.args.get(name, "")
    if raw == "":
        return default
    try:
        return max(lo, min(int(raw), hi))
    except ValueError:
        raise BadRequest(f"{name} must be a whole number.") from None


def weight_arg(name, default):
    """A weight between 0 and 1. NaN and infinity are rejected: they'd produce invalid JSON."""
    raw = request.args.get(name, "")
    if raw == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        value = math.nan
    if not math.isfinite(value):
        raise BadRequest(f"{name} must be a number between 0 and 1.")
    return min(max(value, 0.0), 1.0)


def create_app(data_dir=None):
    """Builds the app. The catalog loads once here; tests pass a small demo catalog's folder."""
    app = Flask(__name__, static_folder=str(FRONTEND), static_url_path="")
    try:
        cat = Catalog(data_dir) if data_dir else Catalog()
        load_error = None
    except FileNotFoundError as e:
        cat, load_error = None, str(e)
    app.config["CATALOG"] = cat

    @app.errorhandler(BadRequest)
    def bad_request(error):
        return jsonify(error=str(error)), 400

    @app.before_request
    def need_data():
        if request.path.startswith("/api/") and cat is None:
            return jsonify(error=load_error), 503

    @app.route("/")
    def index():
        return send_from_directory(FRONTEND, "index.html")

    @app.route("/api/stats")
    def stats():
        r = cat.report
        return jsonify(songs=len(cat.tracks), with_lyrics=int((cat.tracks.lyric_row >= 0).sum()),
                       match_rate=r.get("match_rate"))

    @app.route("/api/search")
    def search():
        q = request.args.get("q", "").strip()
        if len(q) < 2:
            return jsonify(results=[])
        return jsonify(results=cat.search(q, limit=int_arg("limit", 8, 1, 25)))

    @app.route("/api/compare")
    def compare():
        a, b = request.args.get("a"), request.args.get("b")
        if not a or not b:
            return jsonify(error="Pass both a and b track ids."), 400
        if a == b:
            return jsonify(error="Pick two different songs."), 400
        result = similarity.compare(cat, a, b, w_audio=weight_arg("w_audio", 0.6))
        if result is None:
            return jsonify(error="Unknown track id."), 404
        return jsonify(result)

    @app.route("/api/similar/<track_id>")
    def similar(track_id):
        res = similarity.similar_tracks(cat, track_id, k=int_arg("k", 10, 1, 30))
        if res is None:
            return jsonify(error="Unknown track id."), 404
        return jsonify(results=res)

    return app


# Not 5000: macOS uses that port for AirPlay Receiver, so the server couldn't start on a Mac.
DEFAULT_PORT = 5050


def port_from_env(env=os.environ):
    """The port to listen on: $PORT if it's a valid port number, otherwise 5050."""
    value = env.get("PORT", "")
    return int(value) if value.isdigit() and 0 < int(value) < 65536 else DEFAULT_PORT


if __name__ == "__main__":
    create_app().run(debug=False, port=port_from_env())
