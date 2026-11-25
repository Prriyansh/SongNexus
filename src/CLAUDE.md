# src/

## Files at this level

- `CLAUDE.md` — this guide. No other files; all code is in the three folders below.

## Folders

| Folder | Runs on | Purpose |
| --- | --- | --- |
| `app/` | server (+ the client page) | Next routes: `/` page, layout, API route handlers |
| `frontend/` | browser only | the React UI and its client-side logic |
| `lib/` | server | MusicBrainz/Deezer access, mapping, throttling, caching; shared types |

Each area keeps its tests in its own `__tests__/` folder.

Dependency direction: `app/api` → `lib`; `frontend` → `lib/types.ts` (types and pure helpers
only, plus `import type` from `lib/sound.ts`). The frontend must never import `lib/musicbrainz.ts`,
`lib/top-track.ts` or runtime code from `lib/sound.ts`; it talks to
the server through `frontend/api.ts`.

`lib/types.ts` is the contract between server and UI. Changing it changes both sides; prefer
adapting the frontend.
