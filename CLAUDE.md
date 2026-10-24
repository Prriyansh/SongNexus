@AGENTS.md

# Song Nexus — repository guide

Music discovery app: compare two artists or two songs and show how they connect (shared
collaborators, genres, linking songs). Student team project; repo `github.com/Prriyansh/SongNexus`.
Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict), Vitest.

## Files at this level

| File | Purpose |
| --- | --- |
| `README.md` | Project overview, how to run it, layout (for people) |
| `CLAUDE.md` | This guide |
| `AGENTS.md` | Written by `next dev` (Next.js version notes); keep it committed |
| `package.json` / `package-lock.json` | Dependencies, `engines` (Node ≥ 20.9), npm scripts |
| `next.config.ts` | `cacheComponents`, Turbopack root, and rewrites: `/about`, `/about/manual`, `/compare/(artists\|songs)` → `/`; `/prototype` → `public/song-nexus.html` |
| `tsconfig.json` | Strict TypeScript; `@/*` → `src/*` |
| `vitest.config.ts` | Runs `src/**/*.test.{ts,tsx}`, Node environment by default, same `@` alias |
| `eslint.config.mjs` | ESLint with `eslint-config-next` (includes React 19 hook rules) |
| `.nvmrc` | Node 22 for local use and CI |
| `.gitignore` | Ignores `node_modules`, `.next`, `next-env.d.ts`, `*.tsbuildinfo`, `.env*` |

`next-env.d.ts` and `tsconfig.tsbuildinfo` are generated locally and ignored.

## Folders

- `src/` — all application code (see `src/CLAUDE.md`).
- `public/` — static files; `song-nexus.html` is the older prototype at `/prototype`.
- `docs/` — architecture notes, Helen's design handoff, the first mockup.
- `.github/` — CI workflow.

## Working rules

- **Commit messages and PR descriptions must not mention an AI agent** (class requirement): no
  `Co-Authored-By` trailers, no "generated with" lines.
- Prefer small, focused commits; each should pass lint, typecheck and tests, and include tests
  for what it changes.
- The backend (`src/lib`, `src/app/api`) is the source of truth. Adapt the frontend to what the
  API returns rather than changing the API to fit a screen, unless asked.
- Only show data a source actually provides. No invented popularity numbers, audio features or
  placeholder facts; label calculated "insights" as calculated.
- MusicBrainz allows about 1 request/second. Never call it from the browser; go through the API
  routes, which throttle and cache.
- Next 16 differs from older versions: route `params`/`searchParams` are Promises,
  `LayoutProps`/`PageProps` are generated types. Check `node_modules/next/dist/docs/` first.

## Commands

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # Vitest: unit + integration
npm run lint
npm run typecheck  # next typegen && tsc --noEmit (typegen is needed on a fresh clone)
npm run build
```
