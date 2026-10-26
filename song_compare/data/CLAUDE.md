# song_compare/data/

## Files at this level

- `CLAUDE.md` — this guide.

## Folders

- `processed/` (committed) — what the service loads:
  - `tracks.parquet` — one row per song: ids, titles, artists, album, genre, popularity,
    duration, key/mode/tempo/time signature, nine audio features, `lyric_row` (index into the
    vectors, or -1) and `lyrics_analysis` (JSON text of the lyric features, or null).
  - `audio_bounds.json` — 1st/99th percentile per audio feature, for scaling.
  - `tfidf.npz` (sparse) and `lsa.npy` — normalised lyric vectors, one row per `lyric_row`.
  - `match_report.json` — how many songs matched lyrics, with unmatched examples.
- `raw/` (git-ignored) — downloaded datasets and demo CSVs. Never commit these.

Regenerate `processed/` with `prepare_data.py` (see `../README.md`), never by hand.
