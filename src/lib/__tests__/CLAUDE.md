# src/lib/__tests__/

Vitest tests for the server-side integration layer. Run with `npm test` from the repository root.

## Files at this level

- `musicbrainz.test.ts` — mappers, param validation, search and lookup, retries, caching, album counts.
- `collaborators.test.ts` — credit indexing and the mutual-collaborator comparison, from release fixtures.
- `top-track.test.ts` — Deezer artist match, recording match, quota and timeout errors.
- `types.test.ts` — the pure helpers in `../types.ts`.
- `html-integration.test.ts` — structure of `public/song-nexus.html` (the prototype).
- `compare-ui.test.ts` — runs the prototype's Compare script in jsdom with a mocked API.
- `CLAUDE.md` — this guide.

## Patterns

- Inline fixture payloads shaped like real MusicBrainz/Deezer responses; never call the network.
- Inject `fetchImpl` and pass `throttleMs: 0, useCache: false` (and `retryBaseMs: 0`) so tests
  are fast and isolated; call `__clearCache()` when a test relies on the module cache.
- The two prototype tests read `public/song-nexus.html`; update them if that file changes.
