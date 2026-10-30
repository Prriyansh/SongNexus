# src/frontend/components/

React components for Helen's screens. Markup and class names follow her design; styles are in
`../styles.css`, `../product.css` and `../integration.css`.

## Files at this level

- `AboutMe.tsx` — About Me overview and the "Add to your music taste" screen (MusicBrainz
  search; albums come from the picked artist's studio discography; genres from `../genres.ts`).
  Exports `useTaste`, which the details drawer reuses to add and remove favourites.
- `ComparisonDetails.tsx` — the MusicBrainz side-by-side table. For artists it's the main
  table; for songs it's secondary ("07 More about these songs", after `SongAnalysis`): artist,
  release, album, length, genres, rating, links, shared genres and mutual collaborators.
- `ConnectionGraph.tsx` — interactive graph (select, hover, zoom, pan, "Show more"). The parent
  keys it by comparison, so a new pair gets a fresh view; zoom/pan reset when the graph changes.
- `SongAnalysis.tsx` — the main part of a two-song comparison: Ishita's sound and lyrics
  analysis from `/api/sound`. Sections 02–06: how alike (overall match, sound/lyric scores,
  reasons, shared credits), sound profile bars, structure table, lyrics, and songs that sound
  alike (clicking one opens a comparison). One panel explains when the data is missing.
- `PlaylistUpload.tsx` — reads a local file, then matches rows one by one (first 50) through
  the search route, with progress and abort on close.
- `Modal.tsx` — portal dialog/drawer: focus trap, Escape, scroll lock, `#root` inert.
- `Artwork.tsx` — `AlbumCover` (Cover Art Archive art with a disc fallback); `ArtistAvatar` (the
  artist's first studio album cover, as in the earlier prototype, falling back to initials;
  MusicBrainz has no artist photos); `ArtistPicture` (an `ArtistAvatar` that looks up the
  artist's details to find that cover; each new artist costs a lookup, so keep it out of long lists).
- `CLAUDE.md` — this guide.

Components take data and callbacks as props; fetching happens through `../api.ts` (via
`useAsync` or event handlers), never with `fetch` directly.

- `ArtistInsightsPanel.tsx` — bio, awards, labels, audience and shared facts on a two-artist comparison.
- `TasteWeb.tsx` — the My playlist option and the Friends page.
