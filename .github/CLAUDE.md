# .github/

GitHub configuration.

## Files at this level

- `CLAUDE.md` — this guide.

## Folders

- `workflows/ci.yml` — the CI job, on pushes to `main` and on pull requests: checkout, Node from
  `.nvmrc` with the npm cache, `npm ci`, then `lint`, `typecheck`, `test` and `build` (job
  `check`); and, in `song_compare/`, Python 3.12 + `requirements-dev.txt` + `pytest` (job
  `song-compare`).
  Keep it matching the scripts in `package.json`. No secrets are needed: the tests mock
  MusicBrainz and Deezer, and the build makes no network calls.
- `workflows/songnexus-v2.yml` — checks for `songnexus-v2/`, only when that folder or this file
  changes: `server` (uv; ruff format and lint, mypy, import layering, pytest against SQLite and a
  PostgreSQL service, OpenAPI contract, pip-audit), `web` (Node 22; API types match the contract,
  lint, typecheck, Vitest, build, bundle budget, npm audit) and `e2e` (Playwright against the
  built app and a freshly ingested API). Keep it matching the commands in
  `songnexus-v2/README.md`.
