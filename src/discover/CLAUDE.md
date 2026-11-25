# src/discover/

Discover: the people behind the music and how they connect. It is its own area at `/discover`, with
the app's sidebar. It imports nothing from `src/frontend` or `src/lib`. The one link the other way is
`components/SidebarLinks.tsx`, which `src/frontend/App.tsx` puts at the end of the sidebar;
`components/DiscoverShell.tsx` draws the same sidebar around Discover's pages (a test compares them).

## Pages (in `src/app/discover/`)

| URL | What it shows |
| --- | --- |
| `/discover` | Search, and ways in by pair, artist, genre and label |
| `/discover/six-degrees` | The path between two artists (`from`, `to`, `via`, `order`, `avoid`) |
| `/discover/connections` | Collaborators: one artist's web of who they worked with (`artist`, `via`, `open`) |
| `/discover/artist/[id]`, `/song/[id]`, `/label/[id]` | By MusicBrainz ID, so links work across the app |
| `/discover/genre/[id]` | By genre slug |

Every view is in its address, so any of them can be shared. The best-known artists, songs, labels and
genres are prerendered; the rest are made on their first visit and kept. `error.tsx` and
`not-found.tsx` keep the sidebar; an unknown ID is marked `noindex` (Next streams its first
visit, so that one answers 200, and 404 after).

API routes are in `src/app/api/discover/`: `search`, `neighborhood` and `reasons`. They answer from
the catalog file, so they need no keys and call no other service.

## Files

- `data/catalog.json` — the catalog (written by `scripts/discover/export_catalog.py`; never edit by hand).
- `lib/catalog.ts` — reads and indexes it. `lib/graph.ts` — what connects two artists, and how strongly.
- `lib/paths.ts` — Six Degrees. `lib/playlist.ts` — a path as songs.
- `lib/collaborations.ts`, `lib/credits.ts` — who worked with whom, on what.
- `lib/search.ts` — names. `lib/match.ts` — marking what matched. `lib/browse.ts` — ways in.
- `lib/words.ts` — facts as sentences. `lib/metadata.ts` — titles, descriptions and link previews.
- `lib/layout.ts` — the web's layout, camera, names and arrow keys. `lib/images.ts` — photo sizes.
- `lib/links.ts`, `lib/query.ts` — writing and reading addresses.
- `lib/server.ts` — the graph, built once per server instance. `lib/types.ts` — what goes to the browser.
- `components/parts.tsx` — shared pieces; `useWeb.ts` (state and motion), `WebCanvas.tsx` (drawing) and
  `ConnectionExplorer.tsx` (the page around them) are the web. `api.ts` — the browser's only calls.
- `discover.css` — every class starts with `dx-`. `__tests__/`.

## Rules

- Server files (`catalog`, `graph`, `server`, `search`, `words`) never reach the browser. A test follows
  every `"use client"` file's imports to check.
- Only facts a source provides. The catalog is a fixed sample: say "in this catalog", and never that
  two artists aren't connected, only that no connection was found here.
- "Collaborators" means everyone connected by a credit or a band (`WORKING_CATEGORIES`).
- Accessible: everything works with a keyboard, the web has a list with the same content, motion
  respects the viewer's setting, and text meets WCAG AA contrast.
- Sources and licenses: MusicBrainz (CC0; its genres CC BY-NC-SA 3.0), Discogs genres (CC0),
  Wikidata (CC0), ListenBrainz (CC0), Wikimedia Commons photos (CC0, CC BY, CC BY-SA or public domain;
  hot-linked, each credited on its artist's page, and left out when a license asks for a credit no
  one is named for), Cover Art Archive (hot-linked covers), Eurovision Song Contest Dataset (CC BY 4.0,
  without its lyrics). Billboard owns its charts, so only totals per artist are kept, for
  non-commercial use. Rolling Stone's list is left out: its ranks in a public repository would
  republish it.
- Links into the rest of Song Nexus use `AppLink` (a full page load): that app reads the address
  when it starts.
