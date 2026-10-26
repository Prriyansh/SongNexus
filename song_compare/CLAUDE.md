# song_compare/

Song Compare ("Sound & Lyrics"): Ishita's Python (Flask) service that compares two songs on
audio features, structure, credits and lyric analysis. Separate from the Next.js app (it isn't
deployed to Vercel); its page reuses the main app's stylesheets so it looks the same.

## Files at this level

- `README.md` — how to run it, the API, rebuilding the data, lyrics policy, tests.
- `CLAUDE.md` — this guide.
- `requirements.txt` — runtime and data-prep dependencies (ranges; lower bounds are what the
  tests use). `datasets` is opt-in, only for `prepare_data.py --hf`.
- `requirements-dev.txt` — adds pytest.
- `pytest.ini` — tests live in `tests/`; `.` and `backend/` are on the import path.
- `prepare_data.py` — builds `data/processed/` from the Spotify CSV + Genius lyrics: matching,
  lyric NLP, TF-IDF/LSA vectors, audio bounds, match report. `prepare()` is the entry point
  (takes an output folder); `main()` is the CLI.
- `make_demo_data.py` — `write_demo(folder)` writes a small made-up dataset in the same format,
  used by the tests and for trying the app without downloads.

## Folders

- `backend/` — the Flask app and the comparison maths.
- `frontend/` — the page (plain HTML/CSS/JS, no build step).
- `data/` — `processed/` is committed; `raw/` is git-ignored.
- `tests/` — pytest suite.

## Rules

- Never commit raw datasets or lyric text. Only derived numbers go in `data/processed/`.
- Keep processed data in Parquet/JSON/NumPy formats; don't reintroduce pickle or joblib
  (loading them can run code).
- Every API parameter is validated; errors are JSON with a 4xx status, never an HTML 500.
