# Song Compare (sound & lyrics)

Compares two songs on how they sound (Spotify audio features), their structure, shared credits
and their lyrics (sentiment, themes, meaning), and finds more songs that sound alike. A Python
(Flask) API built by Ishita. Its analysis is the "Sound and lyrics" part of the app's song
comparison (how alike the songs are and why, sound profile, structure, lyric mood and themes,
songs that sound alike); the app's API calls it (`CompareRecordingSound`). It also serves a
separate **Sound & Lyrics** page at <http://localhost:5050> with its original song pickers and
comparison layout, whose sidebar links back to the app. Set `NEXUS_URL` on the Flask service to
change the app address (default `http://localhost:5173`).

## Run it

Needs Python 3.12. The processed catalog (76,537 songs, 19,352 with lyric analysis) is in
`data/processed/`, so no downloads are needed to run it.

```bash
cd song_compare
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python backend/app.py
```

`requirements.txt` is what the API needs to run. To rebuild the data, install
`requirements-prepare.txt`; for the tests, `requirements-dev.txt`.

It listens on <http://localhost:5050> (port 5000 is avoided because macOS uses it for AirPlay;
set `PORT` to use another). Then run the app (see the repository README) and compare two songs.
The API finds this service at `SONGNEXUS_SONG_COMPARE_URL` (`server/.env.example` sets
`http://127.0.0.1:5050`). Without it, song comparisons still work and say the sound and lyrics
analysis isn't available.

## Deploy on Vercel

The repository's `vercel.json` deploys it as the `sound` service of the app's Vercel project, at
`/api/*` on the same domain, and the API calls it there; nothing to set up. It can also run as
its own Vercel project: create a project with **Root Directory** `song_compare`. Vercel detects Flask, installs `requirements.txt` (runtime packages only, about
364 MB) and serves `index.py` with the committed catalog (26 MB), under the 500 MB function
limit. Then set `SONGNEXUS_SONG_COMPARE_URL` on the app's API to this project's URL.

## API

| Route | Returns |
| --- | --- |
| `GET /api/stats` | catalog size and lyric match rate |
| `GET /api/search?q=&limit=` | songs by title or artist (`limit` 1–25) |
| `GET /api/match?title=&artist=` | the dataset's version of a named song (how the app maps its catalog songs) |
| `GET /api/compare?a=&b=&w_audio=` | full comparison; `w_audio` (0–1) weights sound vs lyrics |
| `GET /api/similar/<id>?k=` | songs that sound most alike (`k` 1–30) |

Bad parameters get a JSON 400; unknown ids a 404; missing data a 503.

## Rebuild the data (optional)

1. Spotify tracks (BSD licence): download `dataset.csv` from
   [Hugging Face](https://huggingface.co/datasets/maharshipandya/spotify-tracks-dataset) or
   [Kaggle](https://www.kaggle.com/datasets/maharshipandya/-spotify-tracks-dataset) into
   `data/raw/` (that folder is git-ignored; don't commit datasets).
2. Lyrics: [Genius lyrics on Hugging Face](https://huggingface.co/datasets/theelderemo/genius-lyrics-cleaned).
   Either download the parquet files into `data/raw/genius/`, or stream them with `--hf`
   (`pip install datasets` first).
3. Install `pip install -r requirements-prepare.txt`, then build:

```bash
python prepare_data.py --spotify data/raw/dataset.csv --genius data/raw/genius
# or: python prepare_data.py --spotify data/raw/dataset.csv --hf
```

It writes `tracks.parquet`, `audio_bounds.json`, `tfidf.npz`, `lsa.npy` and
`match_report.json` to `data/processed/`.

**No data?** `python make_demo_data.py` writes a small made-up dataset to `data/raw/`; build it
with `python prepare_data.py --spotify data/raw/demo_spotify.csv --genius data/raw/demo_genius.csv`.

## Lyrics and copyright

Lyric text is only held in memory while `prepare_data.py` runs. What's saved and served is
derived numbers (sentiment, themes, structure, vectors); the text is never stored or shown.
Lyrics remain copyrighted by their owners.

## Tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

The tests build a small catalog from the demo data, so they need no downloads. CI runs them on
every push and pull request.
