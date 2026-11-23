# SongNexus — repository guide

Music discovery app: the people behind the music and how they connect. Student team project;
repo `github.com/Prriyansh/SongNexus`. One app: a Python API (`server/`, FastAPI) and a React web
app (`web/`, Vite + TypeScript), with the `song_compare/` sound & lyrics service beside them.

## Files at this level

| File | Purpose |
| --- | --- |
| `README.md` | Overview, how to run it, checks, layout (for people) |
| `CHANGELOG.md` | Release notes, newest first |
| `LICENSE` | Apache License 2.0 (the code; data keeps its sources' licenses) |
| `CLAUDE.md` | This guide |
| `vercel.json` | The Vercel deployment: the web and API services and their routes (see README) |
| `compose.yaml` | Optional local PostgreSQL for the API |
| `.editorconfig`, `.gitattributes`, `.gitignore` | Editor, line-ending and ignore rules |

## Folders

- `server/` — the API, catalog pipeline and core library; see `server/README.md`. Tooling: `uv`.
- `web/` — the web client; see `web/README.md`. Tooling: npm, Node 22.12+.
- `song_compare/` — Ishita's Flask API for the sound & lyrics comparison of two songs; the API
  calls it (see `song_compare/CLAUDE.md`). Deployed as its own Vercel project.
- `docs/` — `data-sources.md`, generated from the source registry by `uv run songnexus sources`
  (a test fails when it is out of date).
- `data/` — committed source snapshots (`samples/`), seeds and evaluation sets. `data/raw/` is a
  local, git-ignored cache.
- `.github/` — CI.

## Working rules

- **Commit messages and PR descriptions must not mention an AI agent** (class requirement): no
  `Co-Authored-By` trailers, no "generated with" lines.
- Prefer small, focused commits; each should pass the checks in `README.md` and include tests for
  what it changes.
- Only show data a source actually provides. No invented popularity numbers, audio features or
  placeholder facts; label calculated "insights" as calculated.
- Every data source is registered in `server/src/songnexus/catalog/sources.py` with its license
  before any code reads from it.
- The repository is **public**. Never commit secrets, `.env` files or copyrighted data such as
  lyrics; keys go in the host's environment variables.
- Only `songnexus fetch*` commands touch the network for catalog data, politely (MusicBrainz
  allows about 1 request/second). Serving reads the ingested catalog.
- `server/openapi.json` is the API contract: regenerate it with `uv run songnexus openapi` and the
  web types with `npm run api:types` when the API changes.
