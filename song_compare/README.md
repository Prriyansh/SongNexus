# Song Compare (Sound & Lyrics)

Compares two songs on how they sound (Spotify audio features), their structure, shared credits
and their lyrics (sentiment, themes, meaning), and finds more songs that sound alike. A Python
(Flask) service with its own page, styled like the main Song Nexus app. Built by Ishita.

## Run it

Needs Python 3.12. The processed catalog (76,537 songs, 19,352 with lyric analysis) is in
`data/processed/`, so no downloads are needed to run it.

```bash
cd song_compare
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python backend/app.py
```

Open <http://localhost:5050>. Port 5000 is avoided because macOS uses it for AirPlay; set `PORT`
to use another. The sidebar links to the main app at `NEXUS_URL` (default
`http://localhost:3000`), and the page loads the main app's stylesheets from `../src/frontend`.

## API

| Route | Returns |
| --- | --- |
| `GET /api/stats` | catalog size and lyric match rate |
| `GET /api/search?q=&limit=` | songs by title or artist (`limit` 1–25) |
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
3. Build:

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
