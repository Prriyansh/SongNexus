# Song Compare (sound & lyrics)

Compares two songs on how they sound (Spotify audio features), their structure, shared credits
and their lyrics (sentiment, themes, meaning), and finds more songs that sound alike. A Python
(Flask) API built by Ishita. Its results appear in Explore's two-song comparison in the main
app (tempo, key, lyric mood, the match score, the sound profile and similar songs); it has no
page of its own.

## Run it

Needs Python 3.12. The processed catalog (76,537 songs, 19,352 with lyric analysis) is in
`data/processed/`, so no downloads are needed to run it.

```bash
cd song_compare
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python backend/app.py
```

It listens on <http://localhost:5050> (port 5000 is avoided because macOS uses it for AirPlay;
set `PORT` to use another). Then run the main app (`npm run dev` at the repository root) and
compare two songs in Explore. The main app finds this service at `SONG_COMPARE_URL`, which
defaults to `http://localhost:5050` in development. Without it, Explore still works and says
the sound analysis isn't available.

## API

| Route | Returns |
| --- | --- |
| `GET /api/stats` | catalog size and lyric match rate |
| `GET /api/search?q=&limit=` | songs by title or artist (`limit` 1–25) |
| `GET /api/match?title=&artist=` | the dataset's version of a named song (how Explore maps MusicBrainz songs) |
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
