# .github/

GitHub configuration.

## Files at this level

- `CLAUDE.md` — this guide.

## Folders

- `workflows/ci.yml` — on every pull request and push to `main`: `server` (uv; ruff format and
  lint, mypy, import layering, pytest against SQLite and a PostgreSQL service, OpenAPI contract,
  pip-audit), `web` (Node 22; API types match the contract, lint, typecheck, Vitest, build, bundle
  budget, npm audit), `e2e` (Playwright against the built app and a freshly ingested API) and
  `song-compare` (Python 3.12, pytest). Keep it matching the commands in `README.md`.
