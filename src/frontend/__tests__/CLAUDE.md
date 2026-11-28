# src/frontend/__tests__/

Vitest tests for the frontend. Run with `npm test` from the repository root.

## Files at this level

- `fixtures.ts` — API payloads typed with `@/lib/types` (Olivia Rodrigo / Taylor Swift, vampire /
  The Fate of Ophelia, Phoebe Bridgers). Reuse these instead of inline objects.
- `api.test.ts` — URLs sent to each route, memoised lookups, error messages, retry after failure.
- `routing.test.ts` — parsing and building every URL form, defaults, share links.
- `setup.test.ts` — setup storage and validation, merging answers.
- `profile.test.ts` — snapshots, profile validation (ids, image hosts, caps), localStorage (jsdom).
- `playlist.test.ts` — CSV/JSON/TXT parsing, MusicBrainz query building, title/artist matching.
- `model.test.ts` — display helpers and the genre list.
- `resolve.test.ts` — `findRecording`'s query and its choice between versions of a song.
- `graph.test.ts` — connection web for artists and songs: paths, roles, expansion, layout bounds.
- `app-harness.tsx` — not a test: what the whole-app tests share. A fake API answering by URL
  (change its answers through `world`, add lookups to `DETAILS`), the app rendered into jsdom,
  and helpers that drive it (`render`, `click`, `type`, `button`, `settle`, `unmountApp`).
  Importing it registers its own setup and cleanup.
- `app.integration.test.tsx` — renders the whole `App` and drives it like a user: comparisons,
  collaborators, top songs, About Me, the drawer, sharing, the Connection Web, Friends, setup.
- `app-flows.test.tsx` — more whole-app paths: shared notes, top songs or similar songs that
  can't be found, drawers for albums and sparse artists and songs, the share sheet, the frame.
- `component-variants.test.tsx` — the song analysis, artist facts, comparison table and
  collaborators rendered alone with every shape of data, loading and error state.
- `dialogs.test.tsx` — the dialog's focus trap and closing, and every way a playlist file goes wrong.
- `connection-graph.test.tsx` — Explore's graph alone: hover, focus, selecting lines and people,
  keyboard and drag panning, zoom limits, "Show more", and its captions.
- `about-me.test.tsx` — About Me alone: empty, full, shared and named; every category of the add
  screen, album browsing, paging, failed and late searches, importing a playlist.
- `friends-flows.test.tsx`, `friends-timing.test.tsx` — Friends and My playlist: opening music
  from a map, files that can't be used, taken, expired or unknown codes, invitation links,
  copying; and (with the playlist codec mocked) answers that arrive after the page moved on.
- `connection-web-flows.test.tsx` — the Connection Web's modes: notes, filters, a song's map,
  zoom-in discovery succeeding and failing, the Comparison mode's partial and failed states.
- `canvas-edges.test.tsx` — both map canvases with the input their own tests don't send: wheels in
  lines and pages, sideways scrolling, zooming mid-drag or mid-animation, second fingers, keys on
  a child, a hidden or resized map, and every kind of explanation card.
- `search-components.test.tsx` — the pickers and first-visit setup with the API mocked and time
  controlled: failed searches, the song library down, late answers.
- `client-app.test.tsx` — `ClientApp` shows a placeholder, then loads `App` in the browser.
- `explore-text.test.ts` — each sentence Explore's insights can show, for every case.
- `share.test.ts` — what each page shares, its label, and that every link reopens the same thing.
- `use-async.test.tsx`, `discovery-hooks.test.tsx` — the hooks with the API replaced: late
  answers, a changed key, unmounting, retries.
- Edge files for inputs the ordinary tests don't send: `logic-edges.test.ts` (the small helpers:
  odd files, oversize lists, missing fields), `graph-edges.test.ts` (comparison graph and layout),
  `map-edges.test.ts` (both maps' detail and discoveries), `connection-web-edges.test.ts`.
- `CLAUDE.md` — this guide.

## Patterns

- DOM tests start with `// @vitest-environment jsdom`.
- `vi.resetModules()` before importing `../api` or `../App`; `api.ts` memoises per module.
- Stub `ResizeObserver` and `window.scrollTo`; set `IS_REACT_ACT_ENVIRONMENT = true` and wrap
  renders and events in `act`.
- Search inputs debounce 300 ms: wait past it (`settle(120)` loops) before asserting.
- Assert on visible text, URLs (`window.location`), stored profile (`localStorage`) and which
  API URLs were called, not on component internals.
- A component rendered by a test helper must be declared once, outside the helper: declaring it
  inside makes every render a new component, so React starts it over and its state is lost.
- jsdom has no `File.text()`; `dialogs.test.tsx` adds one with `FileReader`.
