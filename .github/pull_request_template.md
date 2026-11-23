## What this changes

<!-- One or two sentences: what a user or developer sees differently. Link the issue: "Fixes #123". -->

## How it was checked

<!-- The checks in README.md that apply, and anything you tried by hand (screens, commands). -->

- [ ] `server/`: `uv run ruff format --check . && uv run ruff check . && uv run mypy src && uv run lint-imports && uv run pytest`
- [ ] `web/`: `npm run lint && npm run typecheck && npm test`
- [ ] API changed: regenerated `server/openapi.json` (`uv run songnexus openapi`) and `web/src/api/schema.d.ts` (`npm run api:types`)
- [ ] New data source: registered in `server/src/songnexus/catalog/sources.py` with its license, and `docs/data-sources.md` regenerated (`uv run songnexus sources`)

## Data and privacy

- [ ] No secrets, `.env` files, lyrics or other copyrighted data are committed
- [ ] Everything shown comes from a source that actually provides it (calculated insights are labeled)
