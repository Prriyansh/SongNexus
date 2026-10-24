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

| URL | What it shows |
| --- | --- |
| `/` or `/about` | About Me: your favourite artists, genres, albums and songs |
| `/compare/artists` | Explore: compare two artists (defaults to Olivia Rodrigo and Taylor Swift) |
| `/compare/songs` | Explore: compare two songs |
| `/prototype` | The earlier HTML prototype |

## Repository layout

```
SongNexus/
├── src/
│   ├── app/            Next.js routes: the page at / and the JSON API under /api
│   ├── frontend/       the UI (Helen's design) and its client-side logic
│   └── lib/            MusicBrainz + Deezer integration (rate limits, caching, mapping)
├── public/             static files; song-nexus.html is the prototype served at /prototype
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

CI runs all four on every push to `main` and on pull requests.

## Stack

Next.js 16 (App Router), React 19, TypeScript, Vitest. Data: MusicBrainz and the Cover Art
Archive, with Deezer used only to rank an artist's top song. See
[docs/architecture.md](docs/architecture.md) for how it fits together.
