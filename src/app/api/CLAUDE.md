# src/app/api/

Thin route handlers over `src/lib`. Each one validates input, calls the lib, and maps errors.

## Files at this level

- `CLAUDE.md` — this guide. Each route is a `route.ts` in its own folder:
  - `musicbrainz/search/route.ts` — search proxy
  - `musicbrainz/details/route.ts` — artist / recording lookup
  - `musicbrainz/collaborators/route.ts` — shared collaborators of two artists
  - `top-track/route.ts` — an artist's top song (Deezer rank → MusicBrainz recording)

## Routes

| Route | Params | Returns | Cache-Control |
| --- | --- | --- | --- |
| `GET /api/musicbrainz/search` | `type` (`artist`\|`recording`), `q` (2–200 chars), `limit` (≤25) | `{ results }` | 60 s |
| `GET /api/musicbrainz/details` | `type`, `id` (MBID) | `{ details }` (ArtistDetails \| RecordingDetails) | 10 min |
| `GET /api/musicbrainz/collaborators` | `a`, `b` (two different artist MBIDs) | `{ collaborators }` | 10 min |
| `GET /api/top-track` | `id` (artist MBID), `name` | `{ track }` (or `null`) | 1 h |

Pattern for every handler:

- `ValidationError` → 400 `{ error }`.
- `UpstreamError` → its status with `{ error, retryable }`; log the detail server-side.
- Anything else → 500 with a generic message. Never leak upstream bodies to the client.

`q` is passed to MusicBrainz as a Lucene query, so callers can send field queries like
`recording:"vampire" AND artist:"Olivia Rodrigo"`.

Collaborators is slow when cold (it reads each artist's 3 most recent studio albums, about
10 s for two big artists) and cached afterwards. The header comment in
`musicbrainz/collaborators/route.ts` still says "one request per artist"; that's outdated.
