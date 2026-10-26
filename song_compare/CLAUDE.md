# song_compare/

Song Compare: Ishita's Python (Flask) API that compares two songs on audio features,
structure, credits and lyric analysis. It has no UI: Explore's two-song comparison in the
Next.js app shows its data via `src/app/api/sound` → `src/lib/sound.ts` → this API. It isn't
deployed to Vercel (pandas/SciPy and ~27 MB of data are too big for a function).

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

- `backend/` — the Flask API and the comparison maths.
- `data/` — `processed/` is committed; `raw/` is git-ignored.
- `tests/` — pytest suite.

## Rules

- Never commit raw datasets or lyric text. Only derived numbers go in `data/processed/`.
- Keep processed data in Parquet/JSON/NumPy formats; don't reintroduce pickle or joblib
  (loading them can run code).
- Every API parameter is validated; errors are JSON with a 4xx status, never an HTML 500.
- The JSON shapes are mirrored by the TypeScript types in `src/lib/sound.ts`; change both together.
