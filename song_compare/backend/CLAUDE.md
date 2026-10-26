# song_compare/backend/

The Flask service. Run with `python backend/app.py` from `song_compare/`.

## Files at this level

- `app.py` — `create_app(data_dir=None)` builds the app: loads the catalog once, serves the page
  (`/`), the main app's three stylesheets (`/nexus/styles.css`, `product.css`,
  `integration.css`, nothing else), `/config.js` (`NEXUS_URL` for sidebar links), and the API
  (`/api/stats`, `/api/search`, `/api/compare`, `/api/similar/<id>`). `int_arg`/`weight_arg`
  validate and clamp parameters (bad input → JSON 400). Port: `$PORT` or 5050.
- `catalog.py` — `Catalog(data_dir)` loads `tracks.parquet`, `audio_bounds.json`, `tfidf.npz`,
  `lsa.npy`; scales audio features to 0–1 with 1st–99th percentile bounds; search, `brief()`,
  `detail()`. `time_signature()` maps the dataset's 0/1 to unknown (`None`).
- `similarity.py` — the comparison maths: weighted audio distance (with half/double-time tempo
  folding) calibrated so 50% ≈ a random pair; lyric similarity (LSA meaning, TF-IDF words,
  themes, sentiment); shared credits; key relations on the circle of fifths; plain-English
  reasons; nearest-neighbour `similar_tracks`.
- `nlp.py` — lyric features used during data prep: sections, repetition, vocabulary, sentiment
  (VADER if installed, else a small lexicon), emotions and themes.
- `CLAUDE.md` — this guide.
