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
- `test_catalog.py` — loading, scaling, search, JSON-safe details, time signatures, missing data.
- `test_api.py` — every endpoint, parameter validation (400s, clamping, NaN), the shared
  stylesheets route, port choice.
- `CLAUDE.md` — this guide.

Parse responses with `strict_json()` (rejects NaN/Infinity like a browser). Tests must not
download anything or touch `data/processed/`.
