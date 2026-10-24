# docs/design/

Helen's design handoff for the React frontend.

## Files at this level

- `CLAUDE.md` — this guide.
- `README.md` — her integration guide. It describes a `src/data.ts` contract that was **not**
  implemented; the components now read the real API instead (see `src/frontend/CLAUDE.md`).
  Paths in it refer to the original handoff layout.
- `screenshots/` (folder) — the target look:
  - `about-me.png`, `about-me-songs.png` — About Me
  - `explore-select.png`, `explore-side-by-side.png`, `explore-graph.png` — Explore

Use the screenshots to check visual changes to `src/frontend`. They show Helen's sample
data (Joy Division, Radiohead); the live app shows MusicBrainz data, so content will differ.
Don't edit the guide's body; add notes at the top if something changes.
