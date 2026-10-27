# song_compare/tests/

pytest suite. Run `python -m pytest` from `song_compare/` (after `pip install -r requirements-dev.txt`).

## Files at this level

- `conftest.py` — session fixtures: `demo_dir` (runs `write_demo` + `prepare()` into a temp
  folder), `catalog`, `client` (Flask test client on the demo data), `lyric_ids`.
- `test_nlp.py` — tokenizing, section/repetition parsing, emotions, themes, sentiment sign.
- `test_prepare_data.py` — title/artist normalisation, lyric matching, output files are
  Parquet/JSON (no pickle), lyric text is never stored.
- `test_similarity.py` — tempo folding, key relations, shared credits, score bounds, audio-only
  fallback, similar songs.
- `test_catalog.py` — loading, scaling, search, `find` by title/artist, JSON-safe details, time
  signatures, missing data.
- `test_api.py` — every endpoint, `/api/match`, parameter validation (400s, clamping, NaN),
  standalone page/assets, shared stylesheet allowlist, sidebar address, port choice.
- `test_deploy.py` — serving never imports data-prep packages; runtime requirements stay
  lean; `index.py` exposes the Flask app with the real catalog; `vercel.json` targets it.
- `CLAUDE.md` — this guide.

Parse responses with `strict_json()` (rejects NaN/Infinity like a browser). Tests must not
download anything or touch `data/processed/`.
