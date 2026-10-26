# Song Nexus architecture

How the app is put together: the frontend, the data sources, and how we stay within
MusicBrainz's rate limit. For setup, see the [README](../README.md).

## Frontend

The app is Helen's React design ([`src/frontend/`](../src/frontend/), original handoff in
[`docs/design/`](design/)), rendered as a single client page at `/` and
served by the same Next.js server as the API routes. Everything it shows comes from those routes;
it never calls MusicBrainz or Deezer directly.

| URL | Screen |
| --- | --- |
| `/`, `/about` | About Me: favourite artists, genres, albums and songs |
| `/about/manual` | Add to your taste (MusicBrainz search; albums come from an artist's studio discography) |
| `/compare/artists?artistA=&artistB=` | Explore: two artists, side by side, connection web, insights |
| `/compare/songs?songA=&songB=` | Explore: two songs |
| `/about?profile=…` | A shared About Me snapshot (read-only) |
| `/prototype` | The earlier HTML prototype (`public/song-nexus.html`) |

- `api.ts` is the browser client for our routes; `useAsync.ts` loads data per key.
- `graph.ts` turns the collaborators response into the connection web; Helen's `graph-layout.ts`
  places and routes it. Solid lines are credits; the dashed line is shared genre tags.
- `profile.ts` keeps About Me in localStorage (there are no accounts yet). Shared profile links
  are validated, and only Cover Art Archive images are allowed in them.
- `playlist.ts` reads CSV/JSON/TXT playlist exports in the browser and matches the first 50
  rows with one MusicBrainz search each (about a second per song).
- Helen's genre filter is a **role filter** here, since collaborators carry credited roles
  (producer, mixing, featured…) rather than genres.
- Tests: unit tests per module in `src/frontend/__tests__/`, and
  `app.integration.test.tsx`, which renders the whole app in jsdom against a mocked API.
  Server-side tests are in `src/lib/__tests__/`.

## SongNexus comparison data

SongNexus compares two songs or two artists using real catalogue metadata.

**Data sources**

- **MusicBrainz** (no credentials, just a User-Agent) — the backbone.
  - _Search_ (`/api/musicbrainz/search`) powers the pickers.
  - _Lookup_ (`/api/musicbrainz/details`) enriches the two selected items with
    curated **genres**, **discography** (studio and total album counts, studio
    year span), the **community rating**, and **external links** (official
    site, streaming, Bandcamp, Discogs…). An artist costs two cached requests
    (lookup + album browse); a recording costs one.
- **Cover Art Archive** (no credentials) — representative album/release artwork.
- **Deezer** (no credentials) — used *only* to pick each artist's top song for the
  "Explore track comparison" shortcut (`/api/top-track`). The song is then matched to a
  MusicBrainz recording, so the comparison itself stays on MusicBrainz data. No Deezer
  numbers (fans, plays) are shown.

**Comparison features**

- **Album counts** come from a release-group *browse* (`type=album`), because an artist
  *lookup* only returns the first 25 release-groups. Cards show studio albums plus all albums
  (live, compilations…); when an artist has more than 100 albums the studio count is shown as
  a lower bound ("12+").
- **Mutual collaborators** (`/api/musicbrainz/collaborators?a=&b=`) — people credited on both
  artists' recordings: producers, featured artists, mixers/engineers, vocalists and players.
  Reads the full credits of each artist's 3 most recent studio albums (one request per album,
  cached), so a cold comparison takes ~10 s; it loads after the main cards. Songwriting credits
  live on MusicBrainz *works* and aren't included.
- **Shared genres** — genre tags both artists (or songs) have on MusicBrainz.
- **Shareable URLs** — `/compare/artists?artistA=<mbid>&artistB=<mbid>` and
  `/compare/songs?songA=<mbid>&songB=<mbid>` open straight into a comparison.
- **Not built (no data source):** monthly listeners and audio-feature radar charts.

**Deliberately not shown.** Popularity, play counts, monthly listeners and audio
features (tempo, energy, danceability, mood) are **not** provided by these
sources, so they are omitted rather than estimated. AcousticBrainz (the former
open audio-feature source) is discontinued. Spotify deprecated its audio-feature
endpoints for new apps in November 2024, so new credentials cannot supply them
either. Facts come from catalogued metadata; "insights" are derived from it and
labelled as such.

**Future (optional, needs credentials).** A Spotify integration could add
popularity, artist/album imagery and preview links via the Client Credentials
flow. It would live behind environment variables, kept separate from the
MusicBrainz path — and would still not provide audio features for a new app.

## Rate limiting & caching (serverless caveat)

MusicBrainz asks clients to average ≤ 1 request/second per IP. The integration
layer ([`src/lib/musicbrainz.ts`](../src/lib/musicbrainz.ts)) mitigates this with:

- client-side debouncing and request cancellation;
- a short-lived response cache with **stale-while-revalidate** (serves cached
  data if a refresh hits a transient error);
- **in-flight de-duplication** so concurrent identical requests share one call;
- **bounded exponential backoff with jitter**, honoring `Retry-After`;
- a best-effort ~1 req/s outbound throttle.

> **Important:** the throttle and cache live in **module memory, which is
> per-instance**. On a platform like Vercel multiple instances run concurrently,
> so this does **not** guarantee a global 1 req/s or a shared cache across the
> whole deployment. For a hard global limit, back the throttle and cache with a
> shared store such as **Upstash Redis** or **Vercel KV** (a token bucket keyed
> by provider + a shared response cache). That adds a dependency and a small
> amount of latency/cost, so it is recommended only if rate-limit errors persist
> in production.

## Hosting

The app deploys to Vercel as-is (see the README). Notes for a public deployment:

- Keep Next.js patched. 16.4.0 had critical advisories (remote code execution); `npm audit
  --omit=dev` should report nothing before deploying.
- `/api/musicbrainz/collaborators` sets `maxDuration = 60` because a cold scan takes ~10 s.
- Serverless instances don't share the in-memory cache or throttle (see above), and Vercel's
  outbound IPs are shared with other projects, so MusicBrainz may occasionally answer 503. The
  routes retry, and the UI shows "Try again" if that isn't enough.
- No environment variables are needed.
- The repository is public so Vercel's Hobby plan deploys every collaborator's commits (on a
  private repository it only deploys the owner's). Keep secrets out of the repository; there are
  none today, and any future keys belong in Vercel's environment variables.
