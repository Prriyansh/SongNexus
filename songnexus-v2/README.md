# SongNexus v2

The people behind the music, and how they connect: who worked with whom, how any two artists
connect, and how the artists in your own playlists link up. Every connection is backed by a credit
with a source.

This folder is a self-contained app (a Python API and a Vite + React web app) that lives next to
the Next.js app at the repository root. It has its own dependencies and tooling; nothing here
changes the root app.

## Run it locally (about 5 minutes)

Needs Python tooling [uv](https://docs.astral.sh/uv/) and Node 22.12 or later. No database server
is required. All commands below run from this `songnexus-v2/` folder.

```sh
# API: builds the catalog into a SQLite file, then serves on http://127.0.0.1:8790
cd server
uv sync
cp .env.example .env
uv run songnexus ingest          # under a minute; rejects the catalog if a quality check fails
uv run songnexus serve --reload

# Web app, in a second terminal: http://localhost:5173 (proxies /v1 to the API)
cd web
npm ci
npm run dev
```

PostgreSQL instead of SQLite: `docker compose up -d` in this folder and use the PostgreSQL URL in
`server/.env.example`. Sign-in needs a Firebase project or the Auth emulator (see
`web/.env.example`); everything else works signed out.

### Windows / VS Code PowerShell

In **Terminal → New Terminal**, from `songnexus-v2/`:

```powershell
cd server
uv sync --locked
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
uv run songnexus ingest
uv run songnexus serve --reload
```

Leave that terminal running. Open a **second terminal in `songnexus-v2/`**:

```powershell
cd web
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1 --strictPort
```

Open **http://127.0.0.1:5173/play** for Daily, or **http://127.0.0.1:5173/** for Home. API
readiness is at http://127.0.0.1:8790/healthz and interactive API docs at
http://127.0.0.1:8790/v1/docs. Readiness should report `catalogLoaded: true`.

`npm.cmd` works without changing PowerShell's script execution policy. The server reads
`server/.env`. The example uses SQLite at `songnexus-dev.db` in this folder; no Docker, API key,
Firebase setup or MusicBrainz download is needed to browse or play.

After initial setup, restart with just the two serve commands. Ingest again when the bundled
snapshot changes. Stop each server with **Ctrl+C** in its terminal. If a port is occupied, stop the
existing SongNexus server before restarting; the web proxy expects the API on 8790. Avoid switching
the web port because saved progress belongs to the browser origin.

## Checks

Every change must pass these (the `SongNexus v2` workflow in `.github/workflows/songnexus-v2.yml`
runs them all):

```sh
cd server && uv run ruff format --check . && uv run ruff check . && uv run mypy src tests \
  && uv run lint-imports && uv run pytest && uv run songnexus openapi --check
cd web && npm run lint && npm run typecheck && npm test && npm run build && node scripts/check-bundle-size.mjs
```

Quality gates on the reference catalog: `songnexus quality`, `songnexus eval-search`,
`songnexus eval-import`. Browser tests: [web/e2e/README.md](web/e2e/README.md).

## Layout

```
server/   Python 3.12: core library (pure), catalog pipeline, storage, identity, HTTP API  → server/README.md
web/      React + TypeScript: the web client                                             → web/README.md
data/     samples/ MusicBrainz, Wikidata, Discogs, AcousticBrainz and ListenBrainz snapshots · seeds/ seed artists, pinned decisions, genre table · eval/ labeled sets
deploy/   Cloud Run service and jobs
```

## Data and licensing

Catalog data comes from [MusicBrainz](https://musicbrainz.org). Its core data is CC0; genre tags
are CC BY-NC-SA and kept apart as a separate source. Every source, used or planned, is listed with
its license and tier in the data-source registry
([server/src/songnexus/catalog/sources.py](server/src/songnexus/catalog/sources.py)), which the
ingest pipeline enforces and the API serves at `GET /v1/dataSources`.
