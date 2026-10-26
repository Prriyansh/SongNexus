# src/frontend/__tests__/

Vitest tests for the frontend. Run with `npm test` from the repository root.

## Files at this level

- `fixtures.ts` — API payloads typed with `@/lib/types` (Olivia Rodrigo / Taylor Swift, vampire /
  The Fate of Ophelia, Phoebe Bridgers). Reuse these instead of inline objects.
- `api.test.ts` — URLs sent to each route, memoised lookups, error messages, retry after failure.
- `routing.test.ts` — parsing and building every URL form, defaults, share links.
- `profile.test.ts` — snapshots, profile validation (ids, image hosts, caps), localStorage (jsdom).
- `playlist.test.ts` — CSV/JSON/TXT parsing, MusicBrainz query building, title/artist matching.
- `model.test.ts` — display helpers and the genre list.
- `resolve.test.ts` — `findRecording`'s query and its choice between versions of a song.
- `graph.test.ts` — connection web for artists and songs: paths, roles, expansion, layout bounds.
- `app.integration.test.tsx` — renders the whole `App` in jsdom with `fetch` mocked by URL
  (search, details, collaborators, top-track) and drives it like a user.
- `CLAUDE.md` — this guide.

## Patterns

- DOM tests start with `// @vitest-environment jsdom`.
- `vi.resetModules()` before importing `../api` or `../App`; `api.ts` memoises per module.
- Stub `ResizeObserver` and `window.scrollTo`; set `IS_REACT_ACT_ENVIRONMENT = true` and wrap
  renders and events in `act`.
- Search inputs debounce 300 ms: wait past it (`settle(120)` loops) before asserting.
- Assert on visible text, URLs (`window.location`), stored profile (`localStorage`) and which
  API URLs were called, not on component internals.
