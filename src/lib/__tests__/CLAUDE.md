# src/lib/__tests__/

Vitest tests for the server-side integration layer. Run with `npm test` from the repository root.

## Files at this level

- `musicbrainz.test.ts` — mappers, param validation, search and lookup, retries, caching, album counts.
- `collaborators.test.ts` — credit indexing and the mutual-collaborator comparison, from release fixtures.
- `top-track.test.ts` — Deezer artist match, recording match, quota and timeout errors.
- `types.test.ts` — the pure helpers in `../types.ts`.
- `sound.test.ts` — `compareSound` against a fake song_compare service: ok, not-found,
  same-track, unavailable, timeouts; `songCompareUrl`.
- `html-integration.test.ts` — structure of `public/song-nexus.html` (the prototype).
- `compare-ui.test.ts` — runs the prototype's Compare script in jsdom with a mocked API.
- `credit-sources.test.ts`, `sources.test.ts`, `more-credits.test.ts` — Genius, Discogs, Wikidata,
  ListenBrainz and Last.fm, and the two features that combine them.
- `similar.test.ts`, `taste.test.ts`, `rooms.test.ts`, `artist-neighborhood.test.ts` — the
  Connection Web's sources, playlist maps (including `buildTaste` end to end) and rooms.
- Edge files, one per area, for sparse, odd or failing answers and every fallback:
  `musicbrainz-edges.test.ts` (also the real throttle, timeouts, Retry-After, artists without
  studio albums), `similar-sources.test.ts`, `source-edges.test.ts`, `service-edges.test.ts`
  (sound service, Redis rooms, Deezer top tracks), `artist-neighborhood-edges.test.ts`.
- `fake-web.ts` — not a test: `fakeWeb(route)` answers each request by URL (a body, a
  `Response`, an `Error` for offline, `undefined` for a 404); `quick` options; `asked()`.
- `CLAUDE.md` — this guide.

## Patterns

- Inline fixture payloads shaped like real MusicBrainz/Deezer responses; never call the network.
- Every line and branch of `src/lib` is covered. A new fallback (`?? []`, `|| ""`) needs a test
  that sends a payload without that field.
- Inject `fetchImpl` and pass `throttleMs: 0, useCache: false` (and `retryBaseMs: 0`) so tests
  are fast and isolated; call `__clearCache()` when a test relies on the module cache.
- The two prototype tests read `public/song-nexus.html`; update them if that file changes.
