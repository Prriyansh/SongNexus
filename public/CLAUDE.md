# public/

Static files served as-is from the site root.

## Files at this level

- `CLAUDE.md` — this guide. Like every file here, Next serves it publicly (at `/CLAUDE.md`), so keep it free of anything private.
- `song-nexus.html` — the earlier all-in-one HTML prototype, extended by Alka to call the API
  (Compare view). Reached at `/prototype` via a rewrite in `next.config.ts`.
  `src/lib/__tests__/html-integration.test.ts` and `src/lib/__tests__/compare-ui.test.ts` test it, so keep them in
  sync if you edit it. New UI work belongs in `src/frontend/`, not here.

Put only real static assets here (icons, images). Don't commit unused starter files.
