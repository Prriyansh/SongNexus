# SongNexus

The people behind the music, and how they connect: who worked with whom, how any two artists
connect, how two songs compare in sound and lyrics, and how the artists in your own playlists link
up. Every connection is backed by a credit with a source.

**Status: alpha** (0.2.0-alpha.1, see [CHANGELOG.md](CHANGELOG.md)). One app: a Python API (`server/`) and a Vite + React web app (`web/`), with the sound & lyrics
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

`vercel.json` deploys the whole app as one Vercel project with three
[services](https://vercel.com/docs/services) (in beta on every plan): the web app from `web/` at
`/`, the API from `server/` at `/v1/*` and `/healthz`, and the sound & lyrics service from
`song_compare/` at `/api/*`. The API's build
(`server/vercel_build.py`) ingests the committed snapshots into a SQLite catalog, adds photos and
Wikipedia/Wikidata facts for the best-known artists, and bundles it with the function.

1. In Vercel, import `Prriyansh/SongNexus` (or open the existing project) with **Root Directory**
   `./`. `vercel.json` sets the builds; if the project still has the old Next.js framework preset,
   set **Framework Preset** to **Other**.
2. Deploy. With no environment variables at all, it serves signed out (no accounts), accepts
   writes only from the deployment's own `https://` URLs, and shows "not set up" where an
   optional service is missing.
3. A database (free): in Vercel, **Storage → Create Database → Neon**, connect it to this project,
   then redeploy. Vercel sets `DATABASE_URL`; the app uses it, and each production deploy loads
   the catalog into it (previews keep a bundled copy, so they never write to it). Accounts and
   saved data then persist.
4. Sign-in with Google (accounts are Google accounts only; the API refuses any other sign-in
   method):
   1. In the [Firebase console](https://console.firebase.google.com), create a project (free
      Spark plan), then **Authentication → Sign-in method → Google → Enable**.
   2. **Authentication → Settings → Authorized domains**: add the Vercel production domain
      (e.g. `songnexus.vercel.app`) and any custom domain.
   3. **Project settings → General → Your apps → Web app**: register one and copy its
      `apiKey`, `projectId` and `authDomain`.
   4. In Vercel, set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID` and
      `VITE_FIREBASE_AUTH_DOMAIN` (these are public client settings, not secrets), then
      redeploy. The API uses the same project ID (`SONGNEXUS_FIREBASE_PROJECT_ID` overrides it).
5. Optional environment variables (Project → Settings → Environment Variables), then redeploy:

| Variable | Adds |
| --- | --- |
| `SONGNEXUS_SONG_COMPARE_URL` | Only to use a different sound & lyrics service: by default the API calls this project's own `sound` service on the production domain |
| `SONGNEXUS_DISCOGS_TOKEN` | A higher Discogs rate limit for "More credits" (Discogs works without it) |
| `SONGNEXUS_GENIUS_ACCESS_TOKEN` | Genius in "More credits" |
| `SONGNEXUS_DATABASE_URL` | Only for a database other than the Neon integration's (any PostgreSQL URL; load the catalog with `songnexus ingest` against it). With no database at all, the bundled catalog is copied to the instance's `/tmp` and anything written there lasts only as long as the instance |
| `SONGNEXUS_BUILD_FETCH_LIMIT` | How many artists get photos and facts at build time (default 1500; `SONGNEXUS_BUILD_FETCH=0` skips the fetch) |

Preview deployments sit behind Vercel's login, so their API reaches the sound service on the
production domain; song comparisons in a preview therefore work once production has deployed.

To check a deployment's catalog locally: `cd server && uv run python vercel_build.py`, then serve
it as Vercel would with `uv run --project server uvicorn main:app --app-dir server` from the root.

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
docs/          data-sources.md: every data source and its license (generated)
data/          samples/ source snapshots · seeds/ seed artists, pinned decisions, genre table · eval/ labeled sets
```

## Data and licensing

SongNexus reads 17 sources: MusicBrainz for the catalog (artists, songs, releases, credits,
concerts), Wikidata, Wikipedia and Wikimedia Commons for facts, introductions, readership and
photos, the Cover Art Archive for album covers, the Billboard Hot 100 archive (every weekly chart
since 1958) for chart history, Discogs, Genius, ListenBrainz and AcousticBrainz for comparisons,
and the Spotify Tracks and Genius lyrics datasets behind `song_compare`.
[docs/data-sources.md](docs/data-sources.md) lists each one with its license and what it feeds.
It is generated from the data-source registry
([server/src/songnexus/catalog/sources.py](server/src/songnexus/catalog/sources.py)) with
`uv run songnexus sources`; the ingest pipeline enforces the registry and the API serves it at
`GET /v1/dataSources`. Downloaded data stays in the git-ignored `data/raw/`; nothing copyrighted
(lyrics, cover images, chart files) is committed.

## History

This repository first held the team's Next.js app (Explore, Connection Web, Friends, About Me and
music accounts). It was merged into this app, which took over its features; the Next.js code
remains in the git history. Ishita's `song_compare` service carries on unchanged.

## License

The code is licensed under the [Apache License 2.0](LICENSE). The data each source provides
stays under its own license; see [docs/data-sources.md](docs/data-sources.md).
