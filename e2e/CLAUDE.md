# e2e/

Browser tests of Discover, against the production build. They have their own `package.json`, so the
app's dependencies don't change. `.github/workflows/discover.yml` runs them on pull requests.

```bash
npm run build                          # in the repository's root
cd e2e && npm ci
npx playwright install chromium        # once
npm test
```

`E2E_BROWSER=msedge npm test` uses a browser already on the machine instead. The test server keeps
leaderboards, accounts and Around You in memory (`SONG_NEXUS_MEMORY_STORE=1`); to reuse a server you
started yourself, start it with that set: `SONG_NEXUS_MEMORY_STORE=1 npx next start -H 127.0.0.1 -p 3100`.

## Files

- `playwright.config.mjs` — a desktop and a phone, and the server they test.
- `tests/page.mjs` — what every test starts from. Pictures are stand-ins, any other outside request
  fails the test, and so does any error in the console. It waits until a page is interactive.
- `tests/quality.spec.mjs` — every page, the newer ones too: WCAG A and AA, width, titles and link
  previews, weight, not found, no scripts, photos that don't load.
- `tests/journeys.spec.mjs` — search, Six Degrees, Collaborators and the sidebar, as someone uses them.
- `tests/features.spec.mjs` — Stories, Ask, For you, the games (to the leaderboard), Library, Friend
  paths, You and Around You as someone uses them; the health check, security headers, and personal
  pages kept out of search engines.

Files are `.mjs` so the app's type check, which has no browser packages, leaves them alone.
