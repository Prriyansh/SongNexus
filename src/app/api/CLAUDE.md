# src/app/api/

Thin route handlers over `src/lib`. Each one validates input, calls the lib, and maps errors.

## Files at this level

- `CLAUDE.md` — this guide. Each route is a `route.ts` in its own folder:
  - `musicbrainz/search/route.ts` — search proxy
  - `musicbrainz/details/route.ts` — artist / recording lookup
  - `musicbrainz/collaborators/route.ts` — shared collaborators of two artists
  - `credits/route.ts` — collaborators from Genius and Discogs, with a report per source
  - `artist-insights/route.ts` — bio, awards, labels, audience and shared facts for two artists
  - `similar/route.ts` — similar artists and songs, with reasons, for the Connection Web
  - `taste/route.ts` — a map from one playlist or two (POST; nothing is stored)
  - `rooms/route.ts`, `rooms/[code]/route.ts` — short codes for comparing playlists
  - `top-track/route.ts` — an artist's top song (Deezer rank → MusicBrainz recording)
  - `sound/route.ts` — sound & lyrics comparison of two songs from the song_compare service
  - `sound/search/route.ts` — songs in the sound dataset, for the song pickers

## Routes

| Route | Params | Returns | Cache-Control |
| --- | --- | --- | --- |
| `GET /api/musicbrainz/search` | `type` (`artist`\|`recording`), `q` (2–200 chars), `limit` (≤25) | `{ results }` | 60 s |
| `GET /api/musicbrainz/details` | `type`, `id` (MBID) | `{ details }` (ArtistDetails \| RecordingDetails) | 10 min |
| `GET /api/musicbrainz/collaborators` | `a`, `b` (two different artist MBIDs) | `{ collaborators }` | 10 min |
| `GET /api/credits` | `a`, `b` | `{ credits }` (MoreCredits) | 1 h (`no-store` if a source was partial or failed) |
| `GET /api/artist-insights` | `a`, `b` | `{ insights }` (ArtistInsights) | 1 h (`no-store` if a source failed) |
| `GET /api/top-track` | `id` (artist MBID), `name` | `{ track }` (or `null`) | 1 h |
| `GET /api/sound/search` | `q` (2–200 chars), `limit` (≤25) | `{ status: "ok", results }` or `{ status: "unavailable" }` | 1 h (`no-store` when unavailable) |
| `GET /api/sound` | `aTitle`, `bTitle` (required), `aArtist`, `bArtist` | `{ status, comparison?, similar?, missing?, hint? }` | 1 h (`no-store` when unavailable) |

Pattern for every handler:

- `ValidationError` → 400 `{ error }`.
- `UpstreamError` → its status with `{ error, retryable }`; log the detail server-side.
- Anything else → 500 with a generic message. Never leak upstream bodies to the client.

`q` is passed to MusicBrainz as a Lucene query, so callers can send field queries like
`recording:"vampire" AND artist:"Olivia Rodrigo"`.

Collaborators is slow when cold (up to 25 studio albums per artist, 20 s per artist, reporting
`partial` and `no-store` if unfinished) and cached per album afterwards. Its route exports `maxDuration = 60` so
serverless hosts such as Vercel don't time it out; `src/app/__tests__/api-config.test.ts` checks it.

`/api/sound` never fails because the song_compare service is missing: it answers 200 with
`status: "unavailable"` (plus a `hint` in development), or `"not-found"` when the 2022 dataset
lacks a song. Its URL is `SONG_COMPARE_URL` (default `http://localhost:5050` in development;
on Vercel, the song_compare project's URL). It waits up to 20 s per request for a cold service and
exports `maxDuration = 60`.
