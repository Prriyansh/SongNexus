"""
Song Comparison API (Flask).

  GET /api/stats                      dataset size and cross dataset match rate
  GET /api/search?q=text              find songs by title or artist
  GET /api/compare?a=ID&b=ID          full side by side comparison
  GET /api/similar/ID?k=10            songs that sound most like this one
"""
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from catalog import Catalog
import similarity

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
app = Flask(__name__, static_folder=str(FRONTEND), static_url_path="")

try:
    CAT = Catalog()          # loaded once at startup
    LOAD_ERROR = None
except FileNotFoundError as e:
    CAT, LOAD_ERROR = None, str(e)


@app.before_request
def need_data():
    if request.path.startswith("/api/") and CAT is None:
        return jsonify(error=LOAD_ERROR), 503


@app.route("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


@app.route("/api/stats")
def stats():
    r = CAT.report
    return jsonify(songs=len(CAT.tracks), with_lyrics=int((CAT.tracks.lyric_row >= 0).sum()),
                   match_rate=r.get("match_rate"))


@app.route("/api/search")
def search():
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify(results=[])
    return jsonify(results=CAT.search(q, limit=min(int(request.args.get("limit", 8)), 25)))


@app.route("/api/compare")
def compare():
    a, b = request.args.get("a"), request.args.get("b")
    if not a or not b:
        return jsonify(error="Pass both a and b track ids."), 400
    try:
        w = min(max(float(request.args.get("w_audio", 0.6)), 0), 1)
    except ValueError:
        return jsonify(error="w_audio must be a number between 0 and 1."), 400
    result = similarity.compare(CAT, a, b, w_audio=w)
    if result is None:
        return jsonify(error="Unknown track id."), 404
    return jsonify(result)


@app.route("/api/similar/<track_id>")
def similar(track_id):
    res = similarity.similar_tracks(CAT, track_id, k=min(int(request.args.get("k", 10)), 30))
    if res is None:
        return jsonify(error="Unknown track id."), 404
    return jsonify(results=res)


if __name__ == "__main__":
    app.run(debug=False, port=5000)
