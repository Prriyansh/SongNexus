"""Loads the processed data once and answers search / lookup questions."""
import json
import re
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.sparse as sp

PROCESSED = Path(__file__).resolve().parent.parent / "data" / "processed"

AUDIO_COLS = ["tempo", "energy", "danceability", "valence", "acousticness",
              "loudness", "speechiness", "instrumentalness", "liveness"]

# How much each feature counts toward "sounds alike". Tempo, energy and
# danceability define the feel of a track most, so they weigh a bit more.
AUDIO_WEIGHTS = {"tempo": 1.5, "energy": 1.5, "danceability": 1.5, "valence": 1.0, "acousticness": 1.0,
                 "loudness": 0.75, "speechiness": 0.75, "instrumentalness": 0.5, "liveness": 0.5}

PITCH = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _fold(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]", " ", s)


class Catalog:
    def __init__(self):
        # Parquet + JSON rather than pickle/joblib: loading them can't run code, and they don't
        # depend on the pandas version that wrote them.
        if not (PROCESSED / "tracks.parquet").exists():
            raise FileNotFoundError(
                "No processed data found. Run prepare_data.py first (or make_demo_data.py for a demo).")
        self.tracks = pd.read_parquet(PROCESSED / "tracks.parquet").reset_index(drop=True)
        # Lyric features are stored as JSON text (one object per song, or null).
        self.tracks["lyrics_analysis"] = self.tracks["lyrics_analysis"].map(
            lambda s: json.loads(s) if isinstance(s, str) else None)
        self.bounds = json.loads((PROCESSED / "audio_bounds.json").read_text())
        self.report = {}
        rp = PROCESSED / "match_report.json"
        if rp.exists():
            self.report = json.loads(rp.read_text())

        # Scale each audio feature to 0..1 using robust (1st to 99th percentile) bounds,
        # so a few extreme songs do not squash everyone else into a narrow range.
        self.weights = np.array([AUDIO_WEIGHTS[c] for c in AUDIO_COLS], dtype="float32")
        self.audio = np.stack([self.scale(c, self.tracks[c].to_numpy(dtype="float32")) for c in AUDIO_COLS], axis=1)

        self.tfidf = sp.load_npz(PROCESSED / "tfidf.npz") if (PROCESSED / "tfidf.npz").exists() else None
        self.lsa = np.load(PROCESSED / "lsa.npy") if (PROCESSED / "lsa.npy").exists() else None

        # Calibration: the typical (median) distance between two random songs.
        # We use it later so that a score of 50% means "about as different as a random pair".
        rng = np.random.default_rng(0)
        n = len(self.tracks)
        i, j = rng.integers(0, n, 20000), rng.integers(0, n, 20000)
        self.median_dist = float(np.median(self.weighted_dist(self.audio[i], self.audio[j]))) or 0.3

        # Search index
        self._search = (self.tracks["track_name"].map(_fold) + " " + self.tracks["artists"].map(_fold)).to_numpy().astype(str)

    # ------------------------------------------------------------ audio helpers
    def scale(self, col, values):
        lo, hi = self.bounds[col]
        return np.clip((values - lo) / (hi - lo + 1e-9), 0, 1)

    def weighted_dist(self, a, b):
        """Weighted Euclidean distance, divided by sqrt(sum of weights) so it stays within 0..1."""
        d = np.sqrt(((a - b) ** 2 * self.weights).sum(axis=-1) / self.weights.sum())
        return d

    # ------------------------------------------------------------ lookups
    def search(self, q, limit=8):
        terms = _fold(q).split()
        if not terms:
            return []
        mask = np.ones(len(self.tracks), dtype=bool)
        for t in terms:
            mask &= np.char.find(self._search, t) >= 0
        hits = self.tracks[mask].sort_values("popularity", ascending=False).head(limit)
        return [self.brief(r) for _, r in hits.iterrows()]

    def index_of(self, track_id):
        m = self.tracks.index[self.tracks["track_id"] == track_id]
        return int(m[0]) if len(m) else None

    def brief(self, row):
        return {
            "id": row["track_id"], "title": row["track_name"],
            "artists": [a.strip() for a in str(row["artists"]).split(";")],
            "album": row.get("album_name"), "genre": row.get("track_genre"),
            "has_lyrics": bool(row["lyric_row"] >= 0),
        }

    def detail(self, i):
        r = self.tracks.iloc[i]
        out = self.brief(r)
        key = int(r["key"]) if pd.notna(r.get("key")) and r.get("key") >= 0 else None
        out.update({
            "popularity": int(r["popularity"]), "duration_ms": int(r["duration_ms"]),
            "explicit": bool(r["explicit"]), "tempo": float(r["tempo"]),
            "key": key, "mode": int(r["mode"]),
            "key_name": f"{PITCH[key]} {'major' if r['mode'] == 1 else 'minor'}" if key is not None else "Unknown",
            "time_signature": int(r["time_signature"]),
            "audio": {c: float(r[c]) for c in AUDIO_COLS},
            "lyrics": r["lyrics_analysis"] if isinstance(r["lyrics_analysis"], dict) else None,
        })
        return out
