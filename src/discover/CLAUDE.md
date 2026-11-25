# src/discover/

Discover: the people behind the music and how they connect. It is its own area at `/discover`, with
the app's sidebar. It imports nothing from `src/frontend` or `src/lib`. The one link the other way is
`components/SidebarLinks.tsx`, which `src/frontend/App.tsx` puts at the end of the sidebar;
`components/DiscoverShell.tsx` draws the same sidebar around Discover's pages (a test compares them).

## Pages (in `src/app/discover/`)

| URL | What it shows |
| --- | --- |
| `/discover` | Search, and ways in by artist, genre and label |
| `/discover/six-degrees` | The path between two artists (`from`, `to`, `via`, `order`, `avoid`) |
| `/discover/connections` | Collaborators: one artist's web of who they worked with (`artist`, `via`) |
| `/discover/artist/[id]`, `/song/[id]`, `/label/[id]` | By MusicBrainz ID, so links work across the app |
| `/discover/genre/[id]` | By genre slug |

API routes are in `src/app/api/discover/`: `search`, `neighborhood` and `reasons`. They answer from
the catalog file, so they need no keys and call no other service.

## Files

- `data/catalog.json` — the catalog (written by `scripts/discover/export_catalog.py`; never edit by hand).
- `lib/catalog.ts` — reads and indexes it. `lib/graph.ts` — what connects two artists, and how strongly.
- `lib/paths.ts` — Six Degrees. `lib/collaborations.ts`, `lib/credits.ts` — who worked with whom, on what.
- `lib/search.ts` — names. `lib/browse.ts` — ways in. `lib/words.ts` — facts as sentences.
- `lib/layout.ts` — the connection web's layout and camera. `lib/links.ts` — addresses that carry a search.
- `lib/server.ts` — the graph, built once per server instance. `lib/types.ts` — what goes to the browser.
- `components/`, `api.ts`, `discover.css` (every class starts with `dx-`), `__tests__/`.

`catalog.ts` and `server.ts` read the file system: never import them from a `"use client"` file.

## Rules

- Only facts a source provides. The catalog is a fixed sample: say "in this catalog", and never that
  two artists aren't connected, only that no connection was found here.
- Sources and licenses: MusicBrainz (CC0; its genres CC BY-NC-SA 3.0), Discogs genres (CC0),
  Wikidata (CC0), ListenBrainz (CC0), Cover Art Archive (hot-linked covers), Eurovision Song
  Contest Dataset (CC BY 4.0, without its lyrics). Billboard owns its charts, so only totals per
  artist are kept, for non-commercial use. Rolling Stone's list is left out: publishing its ranks in
  a public repository would republish the list.
- Links into the rest of Song Nexus use `AppLink` (a full page load): that app reads the address
  when it starts.
