# src/lib/

Server-side integration layer. Everything that knows about MusicBrainz or Deezer lives here.

## Files at this level

- `types.ts` — shared domain types (`Artist`, `Song`, `ArtistDetails`, `RecordingDetails`,
  `CollaboratorComparison`…) and pure helpers (`formatDuration`, `partitionGenres`). Safe to import
  from the frontend.
- `musicbrainz.ts` — search, lookup, album browse, collaborator scan, `findRecording`. Contains:
  - the identifying User-Agent (required by MusicBrainz);
  - a ~1.1 s throttle between upstream calls, in-flight de-duplication, retries with backoff
    that honour `Retry-After`;
  - an in-memory cache (search 5 min, lookups 30 min, stale fallback 24 h).
- `top-track.ts` — picks an artist's top song from Deezer (no key) and matches it back to a
  MusicBrainz recording. Deezer is used for ranking only; no Deezer numbers are shown.
- `sound.ts` — client for the song_compare Python API: matches two songs by title and artist,
  then fetches the comparison and similar songs; returns a status (`ok`, `not-found`,
  `same-track`, `unavailable`). Also the TypeScript types for that API's JSON (keep them in sync
  with `song_compare/backend`). `SONG_COMPARE_URL` sets the service URL.
- `CLAUDE.md` — this guide.

## Folders

- `__tests__/` — tests for this layer (see `__tests__/CLAUDE.md`).

## Gotchas

- The throttle and cache are **per server instance** (module memory). On serverless with many
  instances they aren't global; a shared store (e.g. Redis) would be needed.
- An artist *lookup* caps release-groups at 25, so album counts come from a separate browse.
- `life-span.begin` is a **birth date** for people and a formation date for groups. Don't
  present it as a career start.
- Mappers coerce defensively (`str()`, `optionalStr()`); upstream fields can be missing.
