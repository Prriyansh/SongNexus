# src/frontend/

The UI: Helen's design (see `docs/design/`) running on live API data. Browser-only; loaded by
`ClientApp.tsx` with `ssr: false`.

## Files at this level

- `ClientApp.tsx` — loads `App` with `next/dynamic` and `ssr: false`; used by `app/page.tsx`.
- `App.tsx` — shell (sidebar, top bar, footer), routing state, Explore page, details drawer,
  share modal, search picker. Song pickers search the sound dataset first (`/api/sound/search`)
  and open the MusicBrainz version of the pick; without the service they search MusicBrainz.
  For two songs, Explore shows `SongAnalysis` first, then `ComparisonDetails`, graph, insights.
- `api.ts` — the only place that calls the server (`/api/...`), including `soundComparison` for
  song pairs. Memoises lookups per id for the page's lifetime, retries a retryable error
  (MusicBrainz busy) once after 1.5 s, and drops failures so "Try again" refetches.
- `useAsync.ts` — load data for a key; `loading` stays true until that key's result arrives.
- `routing.ts` — URL ↔ state. `/about`, `/about/manual`, `/compare/artists?artistA&artistB`,
  `/compare/songs?songA&songB`, optional `role` and `note`; invalid ids fall back to defaults.
- `graph.ts` — builds the connection web from details + collaborators; `graph-layout.ts`
  (Helen's) positions and routes it.
- `profile.ts` — About Me favourites as snapshots in localStorage (`song-nexus-profile`);
  validates stored and shared profiles.
- `playlist.ts` — parses CSV/JSON/TXT exports; matches rows via MusicBrainz search.
- `resolve.ts` — `findRecording(title, artist)`: the MusicBrainz recording of a dataset song
  (earliest official release). Used by the song pickers and the similar-songs list.
- `types.ts` — `EntityType` (`'artist' | 'song'`) and `Selection` (what the details drawer shows).
- `model.ts` — display helpers: colours, born/formed labels, album-count text, artist cover
  (`artistCover`), the "First 6 of 18 studio albums" note, link names, role names.
- `genres.ts` — genres you can add in About Me, grouped by family (MusicBrainz genre names).
- `styles.css` → `product.css` → `integration.css` — global CSS, loaded in that order by
  `app/layout.tsx`. Helen's two files define the look; put new states in `integration.css`.
- `CLAUDE.md` — this guide.

## Folders

- `components/` — the screen components (see `components/CLAUDE.md`).
- `__tests__/` — unit and integration tests (see `__tests__/CLAUDE.md`).

## Conventions

- Adapt screens to what the API returns; don't fake missing data. Show loading and error
  states, with "Try again" for retryable errors.
- Navigation goes through `go()` in `App.tsx` (pushState/replaceState + state); back/forward
  are handled by `popstate`.
- React 19 hook lint rules apply: no synchronous `setState` in effect bodies and no ref writes
  during render. Derive state from keys (see `useAsync`, the graph's view state) instead.
- Keep Helen's class names and markup structure so her CSS keeps working.
- Search inputs debounce 300 ms and abort the previous request.

- `credits.ts` — merges MusicBrainz collaborators with Genius/Discogs and words what each source checked.
- `similar-web.ts` — layout and lines for the similarity map; `taste.ts` — playlists in links and storage, and the playlist map's layout. `web-navigation.ts` — the map camera.
