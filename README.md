# SongNexus

The people behind the music, and how they connect: who worked with whom, how any two artists
connect, how two songs compare in sound and lyrics, and how the artists in your own playlists link
up. Every connection is backed by a credit with a source.

One app: a Python API (`server/`) and a Vite + React web app (`web/`), with the sound & lyrics
service in `song_compare/`.

## Run it locally (about 5 minutes)

Needs Python tooling [uv](https://docs.astral.sh/uv/) and Node 22.12 or later. No database server
is required. Commands below run from the repository root.

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

PostgreSQL instead of SQLite: `docker compose up -d` at the root and use the PostgreSQL URL in
`server/.env.example`. Sign-in needs a Firebase project or the Auth emulator (see
`web/.env.example`); everything else works signed out.

**Sound & lyrics analysis (optional).** Song comparisons include Ishita's sound and lyrics
analysis when the `song_compare` service is running (otherwise they say it isn't available):

```sh
cd song_compare && pip install -r requirements.txt && python backend/app.py   # http://localhost:5050
```

### Windows / VS Code PowerShell

In **Terminal → New Terminal**, from the repository root:

```powershell
cd server
uv sync --locked
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
uv run songnexus ingest
uv run songnexus serve --reload
```

Leave that terminal running. Open a **second terminal at the repository root**:

```powershell
cd web
npm.cmd ci
npm.cmd run dev -- --host 127.0.0.1 --strictPort
```

Open **http://127.0.0.1:5173/play** for Daily, or **http://127.0.0.1:5173/** for Home. API
readiness is at http://127.0.0.1:8790/healthz and interactive API docs at
http://127.0.0.1:8790/v1/docs. Readiness should report `catalogLoaded: true`.

`npm.cmd` works without changing PowerShell's script execution policy. The server reads
`server/.env`. The example uses SQLite at `songnexus-dev.db` in the repository root; no Docker, API
key, Firebase setup or MusicBrainz download is needed to browse or play.

After initial setup, restart with just the two serve commands. Ingest again when the bundled
snapshot changes. Stop each server with **Ctrl+C** in its terminal. If a port is occupied, stop the
existing SongNexus server before restarting; the web proxy expects the API on 8790. Avoid switching
the web port because saved progress belongs to the browser origin.

## Deploy on Vercel

`vercel.json` deploys the whole app as one Vercel project with two
[services](https://vercel.com/docs/services) (in beta on every plan): the web app from `web/` at
`/`, and the API from `server/` at `/v1/*` and `/healthz`. The API's build
(`server/vercel_build.py`) ingests the committed snapshots into a SQLite catalog, adds photos and
Wikipedia/Wikidata facts for the best-known artists, and bundles it with the function.

1. In Vercel, import `Prriyansh/SongNexus` (or open the existing project) with **Root Directory**
   `./`. `vercel.json` sets the builds; if the project still has the old Next.js framework preset,
   set **Framework Preset** to **Other**.
2. Deploy. With no environment variables at all, it serves signed out (no accounts), accepts
   writes only from the deployment's own `https://` URLs, and shows "not set up" where an
   optional service is missing.
3. Optional environment variables (Project → Settings → Environment Variables), then redeploy:

| Variable | Adds |
| --- | --- |
| `SONGNEXUS_SONG_COMPARE_URL` | The sound & lyrics analysis in song comparisons: the URL of the `song_compare` project (below) |
| `SONGNEXUS_DISCOGS_TOKEN` | A higher Discogs rate limit for "More credits" (Discogs works without it) |
| `SONGNEXUS_GENIUS_ACCESS_TOKEN` | Genius in "More credits" |
| `SONGNEXUS_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_AUTH_DOMAIN` | Sign-in with Google (Firebase) |
| `SONGNEXUS_DATABASE_URL` | Accounts that persist: a PostgreSQL database with the catalog ingested into it (`songnexus ingest` against that URL). Without it, the bundled catalog is copied to the instance's `/tmp` and anything written there lasts only as long as the instance |
| `SONGNEXUS_BUILD_FETCH_LIMIT` | How many artists get photos and facts at build time (default 1500; `SONGNEXUS_BUILD_FETCH=0` skips the fetch) |

The sound & lyrics service is its own Vercel project from the same repository: **Root Directory**
`song_compare` (see [song_compare/README.md](song_compare/README.md)); put its URL in
`SONGNEXUS_SONG_COMPARE_URL`.

To check a deployment's catalog locally: `cd server && uv run python vercel_build.py`, then serve
it as Vercel would with `uv run --project server uvicorn main:app --app-dir server` from the root.
`deploy/` keeps the Cloud Run alternative.

## Checks

Every change must pass these (`.github/workflows/ci.yml` runs them all, plus the browser journeys
and the `song_compare` tests):

```sh
cd server && uv run ruff format --check . && uv run ruff check . && uv run mypy src tests \
  && uv run lint-imports && uv run pytest && uv run songnexus openapi --check
cd web && npm run lint && npm run typecheck && npm test && npm run build && node scripts/check-bundle-size.mjs
cd song_compare && pip install -r requirements-dev.txt && python -m pytest
```

Quality gates on the reference catalog: `songnexus quality`, `songnexus eval-search`,
`songnexus eval-import`. Browser tests: [web/e2e/README.md](web/e2e/README.md).

## Layout

```
server/        Python 3.12: core library (pure), catalog pipeline, storage, identity, HTTP API  → server/README.md
web/           React + TypeScript: the web client                                             → web/README.md
song_compare/  Python (Flask): sound & lyrics comparison of two songs                         → song_compare/README.md
data/          samples/ source snapshots · seeds/ seed artists, pinned decisions, genre table · eval/ labeled sets
deploy/        Cloud Run service and jobs
```

## Data and licensing

Catalog data comes from [MusicBrainz](https://musicbrainz.org). Its core data is CC0; genre tags
are CC BY-NC-SA and kept apart as a separate source. Every source, used or planned, is listed with
its license and tier in the data-source registry
([server/src/songnexus/catalog/sources.py](server/src/songnexus/catalog/sources.py)), which the
ingest pipeline enforces and the API serves at `GET /v1/dataSources`.

## History

This repository first held the team's Next.js app (Explore, Connection Web, Friends, About Me and
music accounts). It was merged into this app, which took over its features; the Next.js code
remains in the git history. Ishita's `song_compare` service carries on unchanged.
