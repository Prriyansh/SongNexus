"""
Builds the processed catalog the API serves.

Inputs
  --spotify  path to the Kaggle Spotify tracks CSV (dataset.csv)
  --genius   path to the Genius lyrics: a parquet file/folder or a CSV
             (or pass --hf to stream it from Hugging Face instead)

Pipeline
  1. Load Spotify tracks, clean, dedupe (same song appears under many genres).
  2. Build a match key for every Spotify track: normalized title + primary artist.
  3. Stream the huge Genius file in batches and keep ONLY rows whose key matches
     (3M+ lyrics rows never sit in memory at once).
  4. Run NLP on matched lyrics: sentiment, emotions, themes, structure,
     TF IDF vectors and LSA (semantic) vectors.
  5. Save features and vectors. Raw lyric text is discarded.
  6. Print and save a match report (how many songs matched across datasets).
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import scipy.sparse as sp
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

sys.path.insert(0, str(Path(__file__).parent / "backend"))
from nlp import analyze_lyrics  # noqa: E402

ROOT = Path(__file__).parent
OUT = ROOT / "data" / "processed"

AUDIO_COLS = ["tempo", "energy", "danceability", "valence", "acousticness",
              "loudness", "speechiness", "instrumentalness", "liveness"]


# ---------------------------------------------------------------- matching keys
def norm_text(s):
    """lowercase, strip accents, drop (feat...), [..], 'remastered' tails and punctuation."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"[\(\[].*?[\)\]]", " ", s)                       # (feat. X), [Live]
    s = re.sub(r"\s[-]\s(remaster|live|mono|stereo|single|radio|version|edit|remix).*$", " ", s)
    s = re.sub(r"\b(feat|ft|featuring)\.?\b.*$", " ", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


_SPLIT = re.compile(r"\s*(?:;|,|&|\band\b|\bx\b|\bfeat\.?\b|\bft\.?\b|\bwith\b)\s*", re.I)


def artist_variants(artist):
    """All artist names a credit string could refer to: whole string + each part."""
    if not isinstance(artist, str):
        return []
    parts = [p for p in _SPLIT.split(artist) if p]
    out = {norm_text(artist)} | {norm_text(p) for p in parts}
    return [a for a in out if a]


def make_key(title_n, artist_n):
    return f"{title_n}|{artist_n}"


# ---------------------------------------------------------------- loading
def load_spotify(path):
    df = pd.read_csv(path)
    df = df.drop(columns=[c for c in df.columns if c.startswith("Unnamed")], errors="ignore")
    need = ["track_id", "artists", "album_name", "track_name"] + AUDIO_COLS
    missing = [c for c in need if c not in df.columns]
    if missing:
        raise SystemExit(f"Spotify file is missing columns: {missing}")
    df = df.dropna(subset=["track_name", "artists"] + AUDIO_COLS).copy()
    df["title_n"] = df["track_name"].map(norm_text)
    df["artist_n"] = df["artists"].map(lambda a: norm_text(a.split(";")[0]))
    df["match_key"] = [make_key(t, a) for t, a in zip(df.title_n, df.artist_n)]
    # The Kaggle file repeats one song once per genre. Keep the most popular copy.
    before = len(df)
    df = df.sort_values("popularity", ascending=False).drop_duplicates("match_key").reset_index(drop=True)
    print(f"Spotify: {before:,} rows -> {len(df):,} unique songs")
    return df


def iter_genius(path=None, hf=False, batch=200_000):
    """Yields DataFrames with columns title, artist, tag, year, lyrics."""
    cols = ["title", "artist", "tag", "year", "lyrics"]
    if hf:
        from datasets import load_dataset  # pip install datasets
        ds = load_dataset("theelderemo/genius-lyrics-cleaned", split="train", streaming=True)
        buf = []
        for row in ds:
            buf.append({c: row.get(c) for c in cols})
            if len(buf) >= batch:
                yield pd.DataFrame(buf)
                buf = []
        if buf:
            yield pd.DataFrame(buf)
        return
    p = Path(path)
    if p.suffix == ".csv":
        for chunk in pd.read_csv(p, chunksize=batch):
            yield chunk
        return
    import pyarrow.dataset as pads  # parquet file or folder of parquet shards
    dataset = pads.dataset(str(p), format="parquet")
    for rb in dataset.to_batches(columns=[c for c in cols if c in dataset.schema.names], batch_size=batch):
        yield rb.to_pandas()


def match_lyrics(spotify, genius_iter):
    """Streams Genius, returns {spotify_row_index: (lyrics, genius_title, genius_artist)}."""
    key_to_idx = {k: i for i, k in enumerate(spotify["match_key"])}
    title_set = set(spotify["title_n"])
    found = {}
    seen = 0
    for batch in genius_iter:
        seen += len(batch)
        batch["title_n"] = batch["title"].map(norm_text)
        cand = batch[batch["title_n"].isin(title_set)]            # cheap pre filter
        for title_n, artist, lyr, title in zip(cand.title_n, cand.artist, cand.lyrics, cand.title):
            if not isinstance(lyr, str):
                continue
            for a in artist_variants(artist):
                idx = key_to_idx.get(make_key(title_n, a))
                if idx is not None:
                    # keep the longest version if a song appears twice
                    if idx not in found or len(lyr) > len(found[idx][0]):
                        found[idx] = (lyr, title, artist)
                    break
        print(f"  scanned {seen:,} Genius rows, matched {len(found):,} songs", end="\r")
    print()
    return found


# ---------------------------------------------------------------- features
def build(spotify, found, n_components=100):
    OUT.mkdir(parents=True, exist_ok=True)
    spotify = spotify.copy()
    spotify["lyric_row"] = -1
    spotify["lyrics_analysis"] = None

    rows, texts = [], []
    for idx, (lyr, _, _) in found.items():
        feats, clean = analyze_lyrics(lyr)
        if feats["structure"]["words"] < 20:                      # too short to compare
            continue
        spotify.at[idx, "lyric_row"] = len(texts)
        spotify.at[idx, "lyrics_analysis"] = feats
        texts.append(clean)
        rows.append(idx)

    tfidf_path, lsa_path = OUT / "tfidf.npz", OUT / "lsa.npy"
    if texts:
        # TF IDF: weights words by how distinctive they are. Cosine similarity of
        # these vectors measures shared vocabulary.
        vec = TfidfVectorizer(stop_words="english", sublinear_tf=True, min_df=2 if len(texts) > 50 else 1,
                              max_df=0.6, max_features=30000)
        X = vec.fit_transform(texts)
        # LSA: compresses TF IDF into dense "topic" dimensions so songs about the
        # same thing score close even without identical words (semantic similarity).
        k = max(2, min(n_components, X.shape[0] - 1, X.shape[1] - 1))
        Z = TruncatedSVD(n_components=k, random_state=0).fit_transform(X)
        sp.save_npz(tfidf_path, normalize(X).tocsr())
        np.save(lsa_path, normalize(Z).astype("float32"))
    else:
        for pth in (tfidf_path, lsa_path):
            pth.unlink(missing_ok=True)

    # Robust scaling bounds for audio features (1st to 99th percentile)
    bounds = {c: [float(spotify[c].quantile(0.01)), float(spotify[c].quantile(0.99))] for c in AUDIO_COLS}
    keep = ["track_id", "track_name", "artists", "album_name", "popularity", "duration_ms", "explicit",
            "key", "mode", "time_signature", "track_genre", "lyric_row", "lyrics_analysis"] + AUDIO_COLS
    tracks = spotify[[c for c in keep if c in spotify.columns]]
    return tracks, bounds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spotify", required=True)
    ap.add_argument("--genius", help="parquet file/folder or CSV of Genius lyrics")
    ap.add_argument("--hf", action="store_true", help="stream Genius lyrics from Hugging Face")
    args = ap.parse_args()
    if not args.genius and not args.hf:
        ap.error("pass --genius PATH or --hf")

    spotify = load_spotify(args.spotify)
    print("Matching Genius lyrics (title + artist)...")
    found = match_lyrics(spotify, iter_genius(args.genius, args.hf))
    tracks, bounds = build(spotify, found)

    n_total, n_lyr = len(tracks), int((tracks.lyric_row >= 0).sum())
    report = {
        "spotify_unique_songs": n_total,
        "matched_with_lyrics": n_lyr,
        "match_rate": round(n_lyr / n_total, 4) if n_total else 0,
        "unmatched_examples": spotify.loc[~spotify.index.isin(found.keys()), ["track_name", "artists"]]
                                      .head(15).to_dict("records"),
    }
    tracks.to_pickle(OUT / "tracks.pkl")
    joblib.dump(bounds, OUT / "audio_bounds.joblib")
    (OUT / "match_report.json").write_text(json.dumps(report, indent=2))
    print(f"Saved {n_total:,} songs. {n_lyr:,} have lyrics ({report['match_rate']:.1%} match rate).")


if __name__ == "__main__":
    main()
