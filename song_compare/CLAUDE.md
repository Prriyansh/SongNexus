# song_compare/

Song Compare: Ishita's Python (Flask) API that compares two songs on audio features,
structure, credits and lyric analysis. Its standalone Sound & Lyrics UI is in `frontend/`,
served at `/` with sidebar links back to the main app (`NEXUS_URL`). Its analysis is also the main part
of Explore's two-song comparison in the Next.js app (`src/frontend/components/SongAnalysis.tsx`),
via `src/app/api/sound` → `src/lib/sound.ts` → this API. Its `/api/search` powers the song pickers. On
Vercel it's its own project (Root Directory `song_compare`) running `index.py` as a Python
function; keep the runtime bundle under Vercel's 500 MB (runtime deps only in requirements.txt).

## Files at this level

- `README.md` — how to run and deploy it, the API, rebuilding the data, lyrics policy, tests.
- `CLAUDE.md` — this guide.
- `index.py` — Vercel entry point: puts `backend/` on the path and exposes `app = create_app()`.
- `vercel.json` — Vercel function settings for `index.py` (30 s; tests and raw data excluded).
- `.python-version` — Python 3.12 (used by Vercel).
- `requirements.txt` — runtime dependencies only (Flask, pandas, NumPy, SciPy, pyarrow); this is
  what a deployment installs, so don't add data-prep or test packages here.
- `requirements-prepare.txt` — adds scikit-learn and vaderSentiment for `prepare_data.py`;
  `datasets` is opt-in, only for `--hf`.
- `requirements-dev.txt` — adds pytest on top of the prepare requirements.
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
