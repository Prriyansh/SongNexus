# song_compare/frontend/

The Sound & Lyrics page, served by `backend/app.py`. Plain HTML/CSS/JS, no build step.

## Files at this level

- `index.html` — the main app's shell (sidebar, top bar, page heading, selection panel) and
  empty result sections. Loads the main app's stylesheets from `/nexus/*.css` first, then
  `style.css`, then `/config.js` and `app.js`.
- `app.js` — pickers with debounced search, compare, similar songs; renders with the main
  app's class names (`chooser`, `selected-card`, `comparison-row`, `audio-row`,
  `insight-block`, `mini-entity`…) and inlined Lucide icons. Escapes all API text with `esc()`.
- `style.css` — only what this page adds on top of the main app's CSS (match score, lyric chips
  layout). Change shared styling in `src/frontend/`, not here.
- `CLAUDE.md` — this guide.

Icons must be inserted as bare `<svg>` inside nav items: the main app's CSS hides `<span>`s in
the collapsed sidebar.
