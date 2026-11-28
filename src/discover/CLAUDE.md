# src/discover/

Discover: the people behind the music and how they connect. It is its own area at `/discover`, with
the app's sidebar. It imports nothing from `src/frontend` or `src/lib`. The one link the other way is
`components/SidebarLinks.tsx`, which `src/frontend/components/AppFrame.tsx` puts at the end of the sidebar;
`components/DiscoverShell.tsx` draws the same sidebar around Discover's pages (a test compares them).

## Pages (in `src/app/discover/`)

| URL | What it shows |
| --- | --- |
| `/discover` | Home: search, today's story, For you, where you left off, and ways in by pair, artist, genre and label |
| `/discover/six-degrees` | The path between two artists (`from`, `to`, `via`, `order`, `avoid`) |
| `/discover/connections` | Collaborators: one artist's web of who they worked with (`artist`, `via`, `open`) |
| `/discover/stories` | Stories found in the credits, one at a time (`story`, counting from 1) |
| `/discover/ask` | A question in plain words, answered from the credits (`q`) |
| `/discover/artist/[id]`, `/song/[id]`, `/label/[id]` | By MusicBrainz ID, so links work across the app |
| `/discover/genre/[id]` | By genre slug |

Every view is in its address, so any of them can be shared. The best-known artists, songs, labels and
genres are prerendered; the rest are made on their first visit and kept. `error.tsx` and
`not-found.tsx` keep the sidebar; an unknown ID is marked `noindex` (Next streams its first
visit, so that one answers 200, and 404 after).

API routes are in `src/app/api/discover/`: `search`, `neighborhood`, `reasons`, `for-you` (picks for
favourite artists and genres) and `today` (the day's story, the same for everyone until midnight UTC).
They answer from the catalog file, so they need no keys and call no other service.

## Files

- `data/catalog.json` — the catalog (written by `scripts/discover/export_catalog.py`; never edit by hand).
- `lib/catalog.ts` — reads and indexes it. `lib/graph.ts` — what connects two artists, and how strongly.
- `lib/paths.ts` — Six Degrees. `lib/playlist.ts` — a path as songs.
- `lib/stories.ts` — Stories: a shared producer, two steps apart, a session musician, label mates, a
  sample. Found once per server instance, the same every time; `storyOfDay` picks one a day.
- `lib/ask.ts` — Ask: reads a question into one of a fixed set (a path, a comparison, a song's
  credits, collaborators, samples, connections, a name) and answers it from the graph. The words only
  pick the question and the names; it never states anything the catalog doesn't hold, and says which
  artist or song each name was taken to be. `lib/question.ts` — telling a question from a name, the
  address that asks it, and the example questions (safe for the browser).
- `lib/for-you.ts` — For you: artists connected to the favourites saved in About Me (those connected
  to more of them first, each with the favourite and credit behind it), then the best-known artists
  of favourite genres. `lib/stored.ts` — what the browser keeps: About Me's favourites (read, never
  written), recently opened artists and hidden artists, all checked when read.
- `lib/collaborations.ts`, `lib/credits.ts` — who worked with whom, on what.
- `lib/search.ts` — names. `lib/match.ts` — marking what matched. `lib/browse.ts` — ways in.
- `lib/words.ts` — facts as sentences. `lib/metadata.ts` — titles, descriptions and link previews.
- `lib/layout.ts` — the web's layout, camera, names and arrow keys. `lib/images.ts` — photo sizes.
- `lib/links.ts`, `lib/query.ts` — writing and reading addresses.
- `lib/server.ts` — the graph, built once per server instance. `lib/types.ts` — what goes to the browser.
- `components/parts.tsx` — shared pieces; `useWeb.ts` (state and motion), `WebCanvas.tsx` (drawing) and
  `ConnectionExplorer.tsx` (the page around them) are the web. `StoryKeys.tsx` moves between stories
  (arrow keys, swipes). `TodayCard`, `ForYouShelf` and `RecentShelf` are the home page's personal
  parts, read in the browser (`useStored`); `RememberVisit` notes each artist page opened. `api.ts` —
  the browser's only calls.
- `discover.css` — every class starts with `dx-`. `__tests__/`.

## Tests

`npm test` runs everything in `__tests__/`: `graph`, `views`, `helpers` and `api` (logic and routes),
`properties` (rules checked on made-up catalogs, and paths against a plain search of every one),
`catalog` (the committed file), `pages` (a spread of every kind of page, rendered whole, with every
link on it followed), `components`, `shell` and `web` (controls, in jsdom) and `sidebar`.
`sparse-pages` renders pages from a made-up catalog with what the real one lacks (undated albums,
a photo without an author); `corners` and `corners-ui` cover the remaining small cases, so every
line and branch is tested. `stories` finds each kind of story in a made-up catalog built by name
(`world.ts`) and checks the real feed; `stories-page` and `stories-ui` cover the page and its keys.
`ask` reads every form of question and answers each kind on a made-up catalog (and checks every
example question gets a real answer); `ask-page` renders each kind of answer; `ask-ui` covers asking
from the search box.
`for-you` covers the picks on made-up catalogs and the `for-you` and `today` routes; `home-ui` covers
what the browser keeps and the home page's personal parts.
`dom.tsx`, `render.tsx`, `fixture.ts` and `world.ts` are helpers.

Beside them: `e2e/` (a real browser; see its guide) and `scripts/discover/test_export_catalog.py`
(`python -m unittest discover -s scripts/discover`; CI holds it at 100% coverage with
`scripts/discover/.coveragerc`).

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
