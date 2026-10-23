# Song Nexus frontend appearance: backend integration guide

This folder contains the React/TypeScript appearance and interaction layer for Song Nexus. It includes 19 source/configuration files and five visual reference screenshots. The dataset, data-processing modules, generated build, dependencies, and original tests were deliberately excluded.

**Integration status:** this is a source handoff, not a standalone runnable application. The screens import `src/data.ts`, which is absent. Your team must implement that module against its own data/backend, or refactor the consumers to use your application's data hooks. Installing dependencies alone will not resolve the missing module.

This README describes the files as delivered. It does not add an API, change the code, or restore the excluded demo dataset. API routes mentioned below are proposed integration boundaries, not existing endpoints.

## 1. Start here

1. Put these files in the team's frontend package. If the repository already has a React/Vite frontend, merge the components and dependencies into it instead of replacing its package/configuration files wholesale.
2. Agree on stable string IDs, catalog/credit shapes, and the album-ID mapping described below.
3. Implement the `src/data.ts` contract in section 4 using backend-backed data.
4. Load and validate the required catalog, contributors, and initial comparison data before importing/rendering the existing app modules.
5. Replace the embedded example IDs/default preferences with valid production defaults, or add guarded empty states. These sample values are still in the unchanged UI files.
6. Connect account persistence and remote queries as needed, then run the build and integration checks in section 11.

The HTTP client, API base URL, authentication, remote loading/error states, cache invalidation, and server persistence are all integration work still to be implemented.

## 2. Included files and ownership

| File | Current responsibility | Integration relevance |
| --- | --- | --- |
| `index.html` | HTML entry, `#root` mount, title, description, theme color | Serve this entry or merge its mount/metadata into the host frontend. |
| `package.json` | React, icons, Vite/TypeScript dependencies and npm commands | Merge with the team's frontend package; see the inherited test-script limitation below. |
| `tsconfig.json` | Strict TypeScript configuration, JSX, browser APIs | Keep equivalent strict checking when integrating. |
| `vite.config.ts` | React Vite plugin | No API proxy, custom deployment base, or backend configuration is present. |
| `src/main.tsx` | `createRoot` and `React.StrictMode` | The place to introduce a bootstrap/loading boundary before importing `App`. |
| `src/App.tsx` | Shell, navigation, Explore, selectors, insights, details drawer, sharing | Main consumer of lookups, comparisons, credits, and graph data. |
| `src/styles.css` | Base styles, controls, panels, layout and responsive rules | Load before `product.css`. |
| `src/product.css` | Product layout overrides, artwork, graph states and responsive refinements | Depends on the base styles; keep both files. |
| `src/types.ts` | `Selection` union for artist, song and album detail actions | Album selections currently carry a song ID; see section 5. |
| `src/graph-layout.ts` | Graph presentation, coordinates, fit and SVG edge routing | Preserves appearance; does not fetch or discover relationships itself. |
| `src/routing.ts` | Hash-route parsing, fallback pairs and share URLs | Requires loaded IDs and valid default pairs. |
| `src/profile.ts` | Preference defaults, catalog validation and localStorage | Replace/bridge persistence; several derived values are initialized at module evaluation. |
| `src/playlist.ts` | CSV/JSON/TXT parsing and exact catalog matching | Operates locally against the already-loaded song catalog. |
| `src/components/AboutMe.tsx` | Taste overview, manual catalog browsing, selections and playlist import | Browses arrays in memory; manual search/pagination are client-side. |
| `src/components/Artwork.tsx` | Artist initials and album-cover rendering/fallbacks | Expects normalized display colors and optional cover URLs. |
| `src/components/ComparisonDetails.tsx` | Side-by-side metadata and musical overlap | Consumes credits, normalized metadata and similarity signals. |
| `src/components/ConnectionGraph.tsx` | Interactive nodes/edges, zoom/pan, expansion and source details | Consumes a synchronous, fully resolved `ComparisonGraph`. |
| `src/components/Modal.tsx` | Portal dialogs/drawers, focus handling, Escape and scroll locking | Uses `document.body` and `#root`; preserve the mount convention or update it deliberately. |
| `src/components/PlaylistUpload.tsx` | File selection/drop, preview, provider labels and import action | No remote upload, OAuth, or streaming-service connection is implemented. |
| `images_for_reference/` | Five screenshots | Design references only; no application module imports these PNGs. |

### Reference screenshots

| Image | What it shows |
| --- | --- |
| [Image_20261023171259_57_34.png](images_for_reference/Image_20261023171259_57_34.png) | About Me: heading, add/upload actions, artist/genre/album columns. |
| [Image_20261023171324_58_34.png](images_for_reference/Image_20261023171324_58_34.png) | About Me: lower cards and selected-song list. |
| [Image_20261023171359_59_34.png](images_for_reference/Image_20261023171359_59_34.png) | Explore: song/artist switch, comparison selectors and selected cards. |
| [Image_20261023171412_60_34.png](images_for_reference/Image_20261023171412_60_34.png) | Explore: side-by-side metadata, credits and similarity explanation. |
| [Image_20261023171426_61_34.png](images_for_reference/Image_20261023171426_61_34.png) | Explore: connection graph, insight panel and related-artist cards. |

Screenshots show the previous sample content. Use them to check composition and interaction placement; production records and cover availability will differ.

## 3. Data loading and the adapter boundary

Every current data lookup is synchronous. Components call `getSong`, `compareMusic` and `makeCompareGraph` during render, and immediately read the returned object or array. Returning a `Promise` from those functions will break those consumers.

For an initial integration with limited changes to presentation:

1. Fetch a complete initial data snapshot through the team's HTTP client.
2. Normalize records into a client store that the new `src/data.ts` adapter can read synchronously.
3. Validate IDs/references and choose valid default comparisons.
4. Only then dynamically import `App` and mount it. Keep the existing static `App` import out of the bootstrap entry if this approach is used.
5. Show loading, retry/error, and empty-catalog states at the bootstrap boundary.

**Why loading order matters:** `profile.ts` computes `allGenres`, `albumSongs`, `validValues` and `defaultProfile` once, when the module evaluates. A loading spinner around `<App />` is too late if `App` was already statically imported. Mutating the arrays after import will not recompute those derived values or trigger React updates.

For a large catalog, use query hooks/state and server-side search/pagination instead. That requires updating the current consumers and moving the derived profile values into reactive state. The current Manual Entries screen searches the full loaded arrays and slices 12 entries per page; it does not request server pages.

Comparison/graph responses fetched after startup also need an explicit loading boundary or a reactive refactor. The existing graph memo depends on the selected IDs, filter, expansion history and narrow-layout flag, not on an external cache version.

No `fetch` client, API URL environment variable, session token handling, or Vite proxy is supplied in this handoff.

## 4. Required `src/data.ts` contract

The following declarations document the **minimum UI-facing contract** consumed by the included files. They are not an implementation or a database schema. Extra backend fields are allowed. Normalize server records to these names/types in the adapter rather than exposing database rows directly.

The current genre vocabulary is shown for compatibility. If the team uses another taxonomy, deliberately map or update `Genre`, `genres` and `subgenres` together. The filter sentinel must remain `'All genres'` unless its consumers are changed.

### Record shapes and exported types

```ts
import type { ComparisonGraph } from './graph-layout';

export type EntityType = 'artist' | 'song';
export type Genre =
  | 'Indie' | 'Pop' | 'Electronic' | 'R&B' | 'Jazz'
  | 'Hip-Hop' | 'Folk' | 'Rock' | 'Latin' | 'Afrobeat';
export type GenreFilter = 'All genres' | Genre;

export interface MetadataEvidence {
  field:
    | 'styles' | 'instrumentation' | 'characteristics'
    | 'description' | 'mood' | 'bpm' | 'key';
  nature: 'documented' | 'editorial' | 'estimated';
  scope: 'artist' | 'album' | 'song';
  sourceUrls: string[];
  note: string;
}

export interface MusicalProfile {
  styles: string[];
  characteristics: string[];
  description?: string;
  evidence: MetadataEvidence[];
}

export interface Artist {
  id: string;
  name: string;
  genres: Genre[];
  subgenres: string[];
  location: string;
  description: string;
  color: string; // Valid CSS color used by artwork.
  aliases?: string[];
  kind?: 'catalog' | 'contributor';
  music?: MusicalProfile;
}

export interface Credit {
  name: string;
  artistId: string; // Must resolve through getArtist(), including contributors.
  role:
    | 'Producer' | 'Featured artist' | 'Vocals' | 'Guitar'
    | 'Bass' | 'Drums' | 'Piano' | 'Keyboards' | 'Organ'
    | 'Harp' | 'Percussion' | 'Trumpet' | 'Saxophone'
    | 'Viola' | 'Violin' | 'Songwriter' | 'Recording engineer'
    | 'Sample source' | 'Co-performer';
  sourceUrl: string;
  scope?: 'recording' | 'composition' | 'album';
  viaSample?: boolean;
}

export interface Song {
  id: string;
  title: string;
  artistId: string;
  albumId: string;
  genre: Genre;
  subgenre: string;
  album: string; // Denormalized display title.
  year: number;
  duration: string; // Display-ready, such as m:ss; use an em dash if unknown.
  color: string;
  credits: Credit[];
  instrumentation: string[];
  bpm: number | null;
  key: string | null;
  mood: string | null;
  energy: number | null; // UI expects 0–100 when present.
  danceability: number | null;
  acousticness: number | null;
  valence: number | null;
  artworkUrl?: string;
  aliases?: string[];
  music?: MusicalProfile;
}

export interface Album {
  id: string;
  artistId: string;
  artistIds?: string[]; // All credited album artists, if applicable.
  title: string;
  year: number;
  artworkUrl?: string;
  credits?: Credit[];
}

export interface ArtistConnection {
  id: string;
  from: string; // Artist/contributor ID.
  to: string;   // Artist/contributor ID.
  type: string; // Display-ready relationship type.
  detail: string;
}

export interface ConnectedSong {
  song: Song;
  label: string;
  detail: string;
}

export interface SimilaritySignal {
  attribute: string;
  score: number;
  shared: string[];
  detail: string;
  scope?: string;
}

export interface SimilarityResult {
  eligible: boolean;
  signals: SimilaritySignal[];
}

export interface GraphNode {
  id: string;
  entityType: EntityType;
  label: string;
  x: number;
  y: number;
  role?: string; // Use exactly 'Comparison anchor' for the two selected nodes.
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
  category: 'factual' | 'similarity';
  detail?: string;
  relationshipId?: string;
  sourceUrls?: string[];
  score?: number;
  onPath?: boolean;
  relationships?: GraphEdge[]; // Underlying records for a grouped visible edge.
}
```

`Credit.artistId` is deliberately required in the normalized contract: the delivered UI dereferences it and uses it for clickable contributor actions, even though a backend/raw credit may initially lack a resolved identity. Resolve identities before rendering those credits.

### Collections and lookup functions

```ts
export declare const artists: Artist[]; // Selectable catalog artists.
export declare const songs: Song[];
export declare const genres: Genre[];
export declare const subgenres: Record<Genre, string[]>;

export declare function getArtist(id: string): Artist | undefined;
export declare function getSong(id: string): Song | undefined;
export declare function getAlbum(id: string): Album | undefined;

export declare function searchArtists(query: string): Artist[];
export declare function searchSongs(query: string): Song[];
export declare function artistSongs(id: string): Song[];
export declare function recordingArtistIds(song: Song): string[];

export declare function connectedTo(id: string): ArtistConnection[];
export declare function connectionBetween(
  left: string, right: string
): ArtistConnection | undefined;
export declare function mutualCollaborators(left: string, right: string): string[];
export declare function connectedSongs(
  id: string, filter?: GenreFilter
): ConnectedSong[];
export declare function shortestPath(
  kind: EntityType, left: string, right: string, filter?: GenreFilter
): string[];

export declare function compareMusic(
  kind: EntityType, left: string, right: string
): SimilarityResult;
export declare function makeCompareGraph(
  kind: EntityType,
  left: string,
  right: string,
  filter: GenreFilter,
  expanded?: string[],
  narrow?: boolean
): ComparisonGraph;
```

| Export/group | Expected behavior |
| --- | --- |
| `artists` / `getArtist` | The array drives browsing, favorite validation and comparisons. Lookups must additionally resolve contributor-only identities referenced by credits/graphs; those identities need not be in the selectable array. |
| `songs` / `getSong` / `getAlbum` | Maintain consistent song-to-artist/album references. Album lookups use the true `song.albumId`. |
| `genres` / `subgenres` | Provide a subgenre array for every listed genre, including empty arrays. The UI calls `subgenres[genre].includes(...)` directly. |
| `searchArtists` | Return artist objects synchronously; preserve matching by names, aliases and subgenres, with case/accent normalization. |
| `searchSongs` | Return song objects synchronously; preserve matching by title/aliases, album and recording-artist names. |
| `artistSongs` | Include a person's credited recordings, not just songs whose lead `artistId` equals that person. Keep sample-source references distinct from actual performer/contributor credits. |
| `recordingArtistIds` | Return unique, resolvable recording-artist IDs, accounting for lead/joint artists and featured/co-performers. Used by playlist matching. |
| `connectedTo` / `connectionBetween` | Return documented artist relationships; an absent direct connection returns `undefined`. |
| `mutualCollaborators` | Return shared collaborator IDs, excluding the selected pair themselves. Every returned ID must resolve through `getArtist`. |
| `connectedSongs` | Return factual recording relationships and their labels/details, filtered when requested. |
| `shortestPath` | Return ordered same-kind IDs including both endpoints; return `[]` when no factual path exists. Similarity links must not create a factual path. |
| `compareMusic` | Always return an object with `signals` and `eligible`. Use `signals: []` and `eligible: false` when evidence is insufficient. Current display logic specially recognizes case-sensitive `'Genre'` and `'Era'` attribute names. |
| `makeCompareGraph` | Return the graph shape in section 6 immediately; honor filter, expansion history and narrow layout. |

Unknown optional metadata should stay unknown. Use `null` for unavailable tempo/key/mood/numeric features, `[]` for collections, and suitable display strings for required descriptive text. Several components explicitly test `=== null`; leaving numeric fields `undefined` can produce misleading rows or invalid bar widths. Convert backend durations to display text and any 0–1 audio features to the UI's 0–100 scale when appropriate; do not invent missing measurements.

## 5. IDs, preferences and embedded sample assumptions

### Album IDs are currently represented by song IDs in selections

`MusicProfile` is declared in `src/profile.ts`:

```ts
type MusicProfile = {
  artists: string[]; // Catalog artist IDs.
  songs: string[];   // Song IDs.
  albums: string[];  // Representative SONG IDs, not Album.id values.
  genres: string[];  // Genre/subgenre labels, not numeric database IDs.
};
```

`albumSongs` takes the first song encountered for each `albumId`. Both `profile.albums` and `Selection { type: 'album', id }` use that representative song's ID. The drawer then resolves `getSong(id)` and uses its `albumId` to obtain real album credits.

If backend preferences store real album IDs, translate them to representative song IDs on read and translate back on write. Keep representative selection deterministic across loads. Alternatively, migrate the selection/profile code together to use real album IDs; changing only the response payload will break it.

### Replace these sample values during integration

| Location | Existing assumption | Required decision |
| --- | --- | --- |
| `src/routing.ts`, `examples` | Song pair `joy-division-disorder` / `radiohead-paranoid-android`; artist pair `joy-division` / `radiohead` | Replace with two valid, distinct IDs per supported mode or make defaults derive from loaded records. |
| `src/profile.ts`, `defaultArtists` / `defaultProfile` | Six fixed artist IDs, three fixed song IDs and six preferred genre labels | Choose empty or user-backed defaults, or map to valid catalog records before first render. |
| `src/components/PlaylistUpload.tsx` | “Load Sample Playlist” embeds three sample tracks plus an unmatched row | Remove/replace this action and demo wording as part of production integration. |
| `App.tsx` and `AboutMe.tsx` | Several labels/messages refer to a sample/demo/local catalog | Update wording when backed by the real service. |

The separate dataset files were excluded, but these UI-embedded defaults were retained because the source code was copied unchanged. In particular, missing default artist/song IDs are not filtered out of the initial fallback profile and may be dereferenced immediately.

With the current comparison/fallback logic, provide at least two selectable artists and two songs, all default IDs, and valid references before rendering the app. Otherwise add intentional empty/insufficient-catalog states. Manual genre browsing also expects a nonempty `artists` array for its colors.

### Current persistence

Preferences use four localStorage keys: `song-nexus-artists`, `song-nexus-songs`, `song-nexus-albums`, and `song-nexus-genres`. Values are JSON arrays. Invalid/stale stored IDs are filtered against the catalog loaded at module evaluation. If storage is unavailable, in-memory interaction still works.

There is no account or server synchronization. For authenticated profiles, hydrate remote preferences before enabling writes, and define when local changes save, retry, and conflict with remote state. `App` currently persists on mount and after each profile update; attaching a remote write there without a hydration guard can overwrite server preferences with initial defaults.

## 6. Graph integration

`ComparisonGraph` is already exported by `src/graph-layout.ts`:

```ts
interface ComparisonGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  nodeWidth: number;
  expandable: string[];
}
```

Return finite world-space pixel coordinates and positive dimensions. Every edge endpoint must appear in `nodes`, every node must resolve through the appropriate lookup, and node IDs must be unique within the graph. Both selected IDs should appear with `role: 'Comparison anchor'`.

The included helper pipeline can be reused by the new adapter:

1. Select valid nodes and factual/similarity records for the pair and genre filter.
2. Find the factual path, keeping both selected anchors visible.
3. Use `presentEdges(records, anchors, path, expanded)` to group visible connections and preserve their explanations/sources.
4. Use `layoutComparison(nodes, edges, anchors, path, narrow)` for positions/dimensions.
5. Add `expandable`: IDs whose “Show more” action can reveal additional nodes or connections.

`ConnectionGraph` then handles SVG routing, fit, zoom, pan, selection, highlights and tooltips. `graph-layout.ts` supplies presentation helpers; the excluded relationship-discovery/business logic must be supplied by the team.

Keep factual links solid and calculated similarity links dashed. Similarity is not evidence of a documented collaboration. Preserve the true type, scope and source URLs of credits and factual connections.

`graphEdgeKey` groups an **unordered endpoint pair plus category**. Group parallel records of the same category into one visible edge with `relationships` retaining the underlying records. Opposite-direction records therefore also share a visible pair; keep their semantic direction in explanations/data rather than expecting directional arrows from this UI.

`expanded` is an ordered click history and may repeat an ID to request another batch from the same node. Do not convert it to a set unless expansion behavior is redesigned. `narrow` becomes true below a 500 px graph container; it is separate from viewport CSS breakpoints. Return bounded graph subsets and preserve both anchors under genre filters; contributor-only artist identities may serve as structural connectors without invented genre tags.

## 7. Playlist workflow

All file handling is currently in the browser. Choosing Spotify, YouTube Music or Apple Music changes only a source label. No login, OAuth, remote playlist fetch, binary upload or streaming-account synchronization occurs.

Accepted files are CSV, JSON and TXT. The component rejects files larger than 2,000,000 bytes; the parser rejects more than 250 nonempty track rows.

| Format | Accepted shape |
| --- | --- |
| CSV | A title column named `Title`, `Track Name`, `Song`, `Name` or `Track`; optional `Artist`, `Artist Name` or `Artists`. Header matching ignores case. Quoted fields, escaped quotes and embedded newlines are parsed. |
| JSON | An array, or an object containing a `tracks`, `songs` or `items` array. Items can be strings, track objects using `title`/`name` and `artist`/`artists`, or nested `track` objects. |
| TXT | One title per line; optionally `Title — Artist`, an en dash, or a spaced hyphen. Blank lines and `#` comment lines are skipped. |

Matching normalizes case, accents and punctuation, then requires the entire title and, when supplied, a recording-artist name/alias. It is not fuzzy matching. The first matching loaded song is used, so duplicate-title resolution deserves an explicit backend policy.

Import previews unmatched rows, deduplicates matched songs by ID, and adds their lead artists, representative albums, genres and subgenres to the profile. It does not create new catalog records or persist anything to a server.

If matching moves to the backend, retain the parsed-row/preview flow and add asynchronous state around the request; `matchPlaylist` cannot simply start returning a Promise without changing its callers.

## 8. Routing and sharing

| Route form | Meaning |
| --- | --- |
| `#about` | Personal music taste overview. |
| `#about/manual` | Manual browse/add screen; category is local component state. |
| `#/compare?songA=<id>&songB=<id>&genre=<genre>` | Song comparison. |
| `#explore?mode=artist&left=<id>&right=<id>&genre=<genre>` | Artist comparison. |
| `#about?profile=<URL-encoded JSON>&note=<text>` | Read-only shared profile snapshot. |

`buildRoute`/`buildShareUrl` also encode comparison notes, and `buildProfileShareUrl` encodes a profile snapshot. Notes are limited to 300 characters. Invalid/duplicate comparison IDs fall back to defaults, making valid defaults and a loaded catalog essential.

These are URL fragments handled by the browser; the fragment is not sent to the HTTP server. Shared About Me links contain the preference snapshot in the URL, not a backend profile ID. Opening one shows that snapshot without replacing the recipient's saved preferences.

Backend-backed short links, revocation, access controls or private sharing would require a separate share service and route changes. The current Copy/Share controls only construct URLs and use browser clipboard/native sharing where available. A localhost URL still points to the recipient's own machine; use the deployed frontend URL for team sharing.

## 9. Backend responsibilities and suggested service boundaries

This folder contains no implemented backend routes. The following is one possible division of work; adapt names, methods and schemas to the team's existing API.

| Proposed service | Purpose | Frontend seam |
| --- | --- | --- |
| `GET /api/catalog` or equivalent bootstrap requests | Initial artists, songs, albums, contributors, genres and normalized credits | Populate the adapter/store before app import. |
| `GET /api/search` | Search/paginate a catalog too large for initial loading | Refactor `SearchChooser` and Manual Entries to asynchronous queries. |
| `GET /api/compare` | Pair metadata, factual paths, similarity explanations and graph records | Cache/normalize response before synchronous reads or introduce query state in Explore/graph. |
| `GET /api/me/music-profile` and `PUT /api/me/music-profile` | Authenticated preference read/write | Replace/bridge `readStoredProfile` and `storeProfile` with hydration/write guards and album-ID translation. |
| `POST /api/playlists/match` | Match parsed rows against the server catalog | Add asynchronous request state around preview/matching. |
| Optional share endpoints | Store and resolve a share ID | Replace URL-embedded snapshot behavior if product requirements call for it. |

Decide where factual relationship construction, shortest paths, contributor resolution and similarity scoring live. The old implementations were excluded; the remaining graph helper only arranges/presents supplied nodes and edges. Avoid reintroducing sample data to satisfy imports.

The supplied Vite config has no proxy. For development, either configure the team's API origin/CORS or add a dev proxy as part of integration. For production, define the frontend base path and API origin in the team's deployment setup. Any third-party service credentials belong in the backend, not in browser-delivered configuration.

## 10. Appearance, browser behavior and deployment

Preserve the existing CSS load order in `App.tsx`:

```ts
import './styles.css';
import './product.css';
```

The CSS is global, including `:root`, body, buttons, inputs, headings and common classes. Review collisions if these screens are embedded in an existing shell. `product.css` overrides base colors and responsive composition; removing it or reversing the order changes the screenshots.

Artist avatars use initials and the record's `color`. Album covers use `song.artworkUrl` when available and fall back to a styled disc if absent or broken. The five screenshots are not runtime artwork. No font files or font-loading imports are bundled; CSS names Inter/Manrope with fallbacks, so exact typography depends on available fonts.

The UI uses browser APIs including `window`, localStorage, `ResizeObserver`, pointer events, portals and `HTMLElement.inert`. It expects a client-rendered DOM. Server rendering requires deliberate browser-API guards/adaptation. Keep focus trapping, Escape dismissal, focus return, keyboard graph controls, visible focus states and reduced-motion styles when integrating.

After integration, Vite builds static frontend assets in `dist/`. Serve those assets alongside or separately from the backend. Hash navigation does not require separate server routes for the hash values. A repository subpath deployment may require setting Vite's `base`; no custom base is supplied.

## 11. Install, build and integration checks

The declared stack is React/React DOM `^18.3.1`, lucide-react `^0.468.0`, Vite `^6.0.5`, TypeScript `^5.7.3` and the React Vite plugin `^4.3.4`. Use a team-standard Node/npm environment compatible with those tools. The export does not pin a Node engine or dependency lockfile.

After implementing the missing data adapter and resolving startup/default-ID assumptions, run these in the frontend package:

```sh
npm install
npm run dev
npm run build
npm run preview
```

Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`. In an existing team repository, follow its package-manager/lockfile conventions instead. For a new standalone package, `npm install` creates the lockfile; `npm ci` requires a lockfile and is not the initial command for this export.

**Inherited test command:** `package.json` still says `"test": "node scripts/test.mjs"`, but `scripts/test.mjs` and the original tests were intentionally omitted. `npm test` is not functional in this handoff until the team adds/replaces its test setup. The build also cannot pass while `src/data.ts` is missing. No successful application build or backend integration is claimed for the exported folder.

### Acceptance checks after integration

- [ ] New session, stored-profile session, invalid URL and empty/insufficient catalog all have deliberate startup behavior; no missing default ID is dereferenced.
- [ ] Every song, contributor, credit and graph endpoint resolves; arrays are present; unavailable numeric metadata uses `null`.
- [ ] About Me adds/removes entries in all four categories; reload persistence works; backend album IDs round-trip through the representative-song mapping.
- [ ] Server preferences hydrate before writes; shared profiles remain read-only and do not replace the user's preferences.
- [ ] Song and artist comparisons support distinct selections, query results, invalid/stale IDs and the genre filter.
- [ ] Comparisons with no direct connection, no factual path or insufficient similarity evidence display the existing honest empty states.
- [ ] Graph anchors remain visible; “Show more,” repeated expansion, fit, zoom, pan, node/edge selection, contributor details and source links work.
- [ ] Playlist parsing/matching covers valid formats, malformed/oversized files, duplicates, unmatched rows and joint/featured artists.
- [ ] Share links restore the pair/filter/note or the profile snapshot on the deployed site.
- [ ] Both stylesheets remain in order; desktop composition matches the five references; narrow screens, long titles and missing artwork remain usable.
- [ ] Dialog focus/Escape, keyboard graph actions and reduced-motion behavior survive integration.
- [ ] The completed frontend passes strict TypeScript/build checks and the team's replacement tests.

## 12. Documentation verification

All 19 source/configuration files and all five reference screenshots were reviewed for this guide. The declarations above cover all 18 runtime exports and eight types imported from the missing data module. The documented contract was substituted in memory for that module and type-checked against all 13 included TypeScript/TSX files with the supplied strict compiler options: no TypeScript diagnostics were reported.

That check verifies interface compatibility only. No adapter implementation was added, no backend endpoints were called, and no runtime/build success is implied. The delivered source/configuration files and screenshots were left unchanged.

