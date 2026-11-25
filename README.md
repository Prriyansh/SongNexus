# Song Nexus

Song Nexus is a music discovery app for listeners aged 15–35. Pick two artists or two songs and it
shows how they connect: the producers, mixers and featured artists they share, the genres they
have in common, and the songs that link them. All facts come from
[MusicBrainz](https://musicbrainz.org) and the [Cover Art Archive](https://coverartarchive.org).

## Run it locally

Requires Node.js 20.9 or newer (`.nvmrc` pins 22). No API keys are needed.

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

Everything runs without keys. These optional environment variables (in `.env.local`, or Vercel's
settings) add more to the two-artist comparison; each page says which sources were checked.

| Variable | Adds | Without it |
| --- | --- | --- |
| `GENIUS_ACCESS_TOKEN` | Song-level producers and writers from Genius | Genius is skipped |
| `DISCOGS_TOKEN` | A higher Discogs rate limit (60 requests a minute, not 25), so more albums per scan | Discogs still runs, more slowly |
| `LASTFM_API_KEY` | Last.fm listeners and artists similar to both | Last.fm is skipped |
| `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`) | Short friend codes when deployed: rooms are stored in Redis for a week | In production, Friends falls back to a long link holding the playlist. In development, rooms live in memory |

The sidebar contains **About Me**, **Connection Web**, **Friends** and **Explore**. Connection Web
starts from an artist, a song or your playlist, and maps what's similar: closer means more similar,
calculated from listening data, and selecting anything says why it's there. Friends puts two playlists on
one map, joined with a 6-character code, with colors for yours, theirs, what you share and what each of
you should try. Explore compares two artists or songs in depth, including credits. Explore keeps its **2 Songs** and **2 Artists**
tabs, with sound and lyrics analysis included in **2 Songs**. The standalone comparison page
remains available at <http://localhost:5050>, with sidebar links back to About Me and Explore.
Set `NEXUS_URL` for Flask if the main app uses a different address.

| URL | What it shows |
| --- | --- |
| `/` or `/about` | About Me: your favourite artists, genres, albums and songs |
| `/connections` | Connection Web: similar artists and songs from an artist, a song or your playlist |
| `/friends` | Friends: compare playlists with a friend using a short code (`/friends?code=ABC234`) |
| `/compare/artists` | Explore: compare two artists (defaults to Olivia Rodrigo and Taylor Swift) |
| `/compare/songs` | Explore: compare two songs |
| `/prototype` | The earlier HTML prototype |

## Share it (deploy to Vercel)

The app needs a server (its API routes call MusicBrainz), so share it by deploying it. Vercel's
free plan works with no configuration and no API keys:

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. **Add New → Project**, import `Prriyansh/SongNexus`, keep the detected defaults
   (framework Next.js, root directory `./`), and click **Deploy**.
3. Share the `https://<project>.vercel.app` link it gives you.

Every push to `main` redeploys that link, and pull requests get their own preview links. The
in-app **Share** button builds links on whatever domain the app is served from, so comparison
and About Me links work as soon as it's deployed.

**Deploying teammates' commits.** The repository is public because Vercel's free (Hobby) plan
only deploys commits by the project owner when the repository is private; for public
repositories anyone's commits deploy. If a commit's Vercel check says *"GitHub couldn't verify an
account for the commit"*, the author's `git config user.email` isn't an email on their GitHub
account: add it under GitHub → Settings → Emails, or change the git setting to one that is.

### Deploying the sound service on Vercel

The song analysis runs as a second Vercel project from the same repository:

1. In Vercel, **Add New → Project**, import `Prriyansh/SongNexus` again, set **Root Directory**
   to `song_compare` (Vercel detects Flask) and deploy. Note its URL, e.g.
   `https://songnexus-sound.vercel.app`.
2. In the main Song Nexus project, **Settings → Environment Variables**, add
   `SONG_COMPARE_URL` with that URL (no trailing slash), then redeploy.

The first comparison after a quiet spell takes a few extra seconds while the service starts.

## Repository layout

```
SongNexus/
├── src/
│   ├── app/            Next.js routes: the page at / and the JSON API under /api
│   ├── frontend/       the UI (Helen's design) and its client-side logic
│   └── lib/            MusicBrainz + Deezer integration (rate limits, caching, mapping)
├── public/             static files; song-nexus.html is the prototype served at /prototype
├── song_compare/       Python API for the sound & lyrics part of song comparisons
├── docs/
│   ├── architecture.md data sources, caching, API and frontend details
│   ├── design/         Helen's design handoff and reference screenshots
│   └── prototype/      the first HTML mockup, from the paper sketches
├── .github/workflows/  CI: lint, type checks, tests and build on every push and PR
└── package.json, next.config.ts, tsconfig.json, vitest.config.ts, eslint.config.mjs
```

Tests live in a `__tests__/` folder inside each area of `src/`. Every folder has a `CLAUDE.md`
describing the files at that level and the conventions to follow.

## Checks

```bash
npm test            # unit + integration tests (Vitest)
npm run lint        # ESLint
npm run typecheck   # Next route types + tsc
npm run build       # production build
```

CI runs all four on every push to `main` and on pull requests, plus the `song_compare` tests.

## Sound & lyrics in song comparisons (song_compare)

Comparing two songs in Explore is mainly Ishita's sound and lyrics analysis: how alike the songs
are and why, their sound profile, structure (tempo, key, sections), lyrics (mood, themes) and
songs that sound alike. Song pickers search its library of ~76k songs, so picks have the full
analysis. MusicBrainz release details and credits follow. The analysis comes from a separate
Python API in [song_compare/](song_compare/README.md); run it next to the app:

```bash
cd song_compare && pip install -r requirements.txt && python backend/app.py   # http://localhost:5050
```

Without it, everything else works and the comparison says the sound analysis isn't available.
On Vercel it's a second project; see [Deploying the sound service](#deploying-the-sound-service-on-vercel).

## Stack

Next.js 16 (App Router), React 19, TypeScript, Vitest. Data: MusicBrainz and the Cover Art
Archive, with Deezer used only to rank an artist's top song. Two-artist comparisons add Wikidata,
Wikipedia, ListenBrainz, Discogs, and with keys Genius and Last.fm. See
[docs/architecture.md](docs/architecture.md) for how it fits together.
