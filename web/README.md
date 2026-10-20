This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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
- **Genre hub** — shared genres in the middle, each artist's own genres on either side.
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
layer (`src/lib/musicbrainz.ts`) mitigates this with:

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

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
