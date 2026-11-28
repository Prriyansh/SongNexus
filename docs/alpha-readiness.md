# Alpha readiness

What to set up and check before an alpha deployment on Vercel, and what the alpha deliberately
leaves out.

## 1. Settings in Vercel

Everything runs without any of these; each turns something on.

| Variable | Turns on | Without it |
| --- | --- | --- |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (Vercel KV / Upstash Redis integration) | Leaderboards, accounts, Around You, short Friends codes, shared rate-limit counts | Those say they aren't set up; limits count per server instance |
| `GOOGLE_CLIENT_ID`, `SESSION_SECRET` (32+ random characters) | Sign in with Google on You | Everything is kept in the browser |
| `GEMINI_API_KEY` (free, from Google AI Studio) | AI search in Ask | Ask reads questions with its patterns only |
| `AI_DAILY_LIMIT` (default 200), `GEMINI_MODELS` | The day's AI readings, and which free models to try | The defaults |
| `LASTFM_API_KEY` | Last.fm in Explore and Library | Last.fm is skipped |
| `GENIUS_ACCESS_TOKEN`, `DISCOGS_TOKEN` | More credits in Explore | Genius is skipped; Discogs runs slower |
| `SONG_COMPARE_URL` | Sound and lyrics in song comparisons (the `song_compare` project's URL) | Song comparisons say sound and lyrics are unavailable |

For sign-in, the Google OAuth client's **Authorized JavaScript origins** must include the deployment's
URL (and `http://localhost:3000` for local use). Never set `SONG_NEXUS_MEMORY_STORE` in Vercel: it
is for browser tests and one-server demos, and loses data between instances.

## 2. Check the deployment

1. Open `/api/health`. `ok` should be `true` and `problems` empty; `features` shows what is on. It
   never shows a secret's value.
2. Click through: `/discover` (search, today's story), `/discover/stories`, `/discover/ask` (ask
   "Who produced Umbrella?"), `/discover/games` (play one), `/discover/library`,
   `/discover/friends`, `/discover/around`, `/discover/you`, and the app at `/` (Explore, About Me,
   Connection Web, Friends).
3. With sign-in on: sign in on You, play a game, sign in from another browser, and see the result
   there.

## 3. What CI holds

Pull requests to `main` run (`.github/workflows/`):

- lint, typecheck, and every Vitest test at **100%** statement, branch, function and line coverage
  for `src/` (unit tests, route tests against in-memory storage, whole-app tests in jsdom, pages
  rendered whole on the server, and a check that server code takes only components and types from
  client modules);
- `song_compare` (pytest) and the catalog export at 100% coverage;
- the production build;
- browser tests against the production build on a desktop and a phone: every Discover page for
  WCAG A/AA, width, titles and weight, and every feature used end to end.

## 4. Safeguards

- **Per-visitor limits** (an hour at a time, `src/discover/lib/limits.ts`): Connect steps and quiz
  answers 600, scores 30, sign-ins 20, saves 600, joining or leaving communities 30, listening reads
  60, Your Nexus 300, AI readings 30. Over a limit: 429 with `Retry-After`.
- **AI search** is capped per day, remembers readings, never logs a question, stores nothing on
  Google's side, and the Ask page says that questions it reads go to Google.
- **Security headers** on every response (no sniffing, no framing by other sites, no camera,
  microphone or location, strict referrers, HSTS); personal pages are kept out of search engines;
  changes to accounts must come from the site itself; sessions are signed, HTTP-only cookies.
- **MusicBrainz** is called only from the server, throttled to about one request a second and cached.

## 5. Known limits of the alpha

- Discover's catalog is a fixed sample: a missing credit doesn't mean two artists never met.
- Library reads ListenBrainz, Last.fm and Deezer by public username; Spotify, Apple Music and
  YouTube Music aren't connected.
- Rolling Stone's 500 Greatest Albums is left out on purpose (copyright).
- On Gemini's free tier, Google may use the questions AI search reads to improve its products.
- No Content Security Policy yet: Google's sign-in script and the app's inline styles need one
  written with care.
- Browser tests cover Discover; the app at `/` is tested whole in jsdom with its sources stubbed,
  since a real browser run would call MusicBrainz and the other sources live.

## 6. If something goes wrong

Vercel keeps every deployment: **Instant Rollback** in the project's Deployments tab returns to the
previous one in seconds. Redis data (leaderboards, accounts, communities) is unaffected by a rollback.
