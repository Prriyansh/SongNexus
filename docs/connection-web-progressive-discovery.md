# Progressive local artist discovery: prompt and execution plan

The [zoom-dependent detail update](connection-web-level-of-detail.md) supersedes this document's requirement to display every cached artist at every zoom. The source-backed discovery and cache retention described below still apply.

## Implementation prompt

Make zoom-in reveal additional connected and similar artists in the area being explored. Do not implement Close view by reducing the number of artists, filtering away existing genres, replacing the map, shrinking the discovery budget, or moving existing points out of view. Preserve the viewport-sized, non-scrolling page, scattered placement, constant avatar sizes, pan controls, artist drawers, and absence of legends.

Treat zoom-in as a request for more local detail. The mouse pointer defines the area of focus; zoom buttons use the map center. Find the nearest artist in that area, including a surrounding discovery artist rather than only one of the original selections. Load that artist's neighborhood and progressively reveal more candidates around the focus point. Retain every artist already loaded in the current map. Keep its position and camera pan unchanged as more data arrives. Zoom-out may add more diverse styles, but it must not remove previous discoveries. Bound the total map size and upstream requests without evicting displayed artists.

Build candidates from multiple independent MusicBrainz signals: shared genres and subgenres; the artist's associated country plus musical style; album debut/release era; labels actually listed on releases; documented group members, former bands and collaborations; and bands sharing a documented member. Prefer candidates supported by several signals. Use group founding years or album/release dates for musical eras, never a solo artist's birth year. A label credit means a release on that label, not a claim that the artist is currently signed to it. Keep missing metadata unknown. Use catalog identifiers, source URLs and concise reasons, not invented relationships.

Keep surrounding points unlinked. Only a documented relationship path between the selected artists may have lines; matching style, country, era or label alone never creates a line. Do not add any legend. Provide the discovery reason in the artist's existing caption/title instead of adding explanatory panels. Preserve working data and camera position on failures or late responses, deduplicate requests, and support retry.

Verify the result with tests and the actual browser: zoom-in must increase the loaded set when more matches are available; previous IDs and point positions must remain present; a zoom focused near a context artist must request that artist; progressive data must not reset the camera; unknown data must not become asserted similarity; genres/country/era/labels/memberships must each have source-backed coverage; no legend or document scrollbar may appear.

## Execution plan

1. Audit scope-based pruning, camera projection and layout resets. Inspect existing metadata and verify supported MusicBrainz query fields and relationship includes.
2. Extend artist lookups with documented artist relationships. Add a bounded, cached neighborhood endpoint that combines style/country searches, album-era searches, sampled release labels, members, former bands and shared-member bands. Preserve partial results.
3. Add pure candidate merging and ranking, plus cumulative client discovery. Initial, broader and focused results append to the same map instead of replacing it.
4. Pass pointer/center focus from the canvas to discovery. Make local detail zoom reveal more artists without scaling avatars or displacing existing points. Append new positions around the area of focus while preserving existing coordinates.
5. Add regression tests for retention, local expansion, sources and missing data, stable layout, retries, and focus selection. Run TypeScript checks, the full suite and a production build.
6. Verify real local zoom on the browser map, inspect artist IDs/positions before and after, check zoom around a surrounding artist, and confirm the page remains fixed to its viewport. Save a preview and verification results.

## Source contracts

- [MusicBrainz artist search fields](https://musicbrainz.org/doc/MusicBrainz_API/Search/ArtistSearch): tags, associated country, group type and begin date.
- [MusicBrainz release search fields](https://musicbrainz.org/doc/MusicBrainz_API/Search/ReleaseSearch): label identifiers and dated release credits.
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API): artist relationships and browsing releases with labels/artist credits. All requests use the app's existing throttled server transport.

Catalog coverage is incomplete. Sampled releases provide evidence of a label credit, not exhaustive label history; absence of a result is not evidence that two artists have no connection.

## Execution and verification

- Implemented cumulative discovery (up to 120 surrounding artists) and stable append-only positions. Wheel focus can expand any artist on the map; zoom buttons use the map center. Artist sizes stay fixed, and existing points are never evicted by zoom.
- Added source-backed neighborhood queries and multi-signal ranking. Repeated captions of the same evidence type cannot outweigh independent evidence. Partial failures retain useful results and can be retried.
- Loading and connection status now overlay the map. Live testing caught and corrected the former status row shrinking the canvas and causing a layout reset.
- Full suite: **224 tests passed**. A final placement/ranking check passed **19 tests**. Production build and TypeScript passed; ESLint passed on the changed implementation. The repository-wide lint command reports only three warnings in the pre-existing Python virtual environment's sklearn JavaScript.
- Real wheel zoom at **1440 × 900** grew the map from **16 to 26 artists**; at the native **474 × 695** size it grew from **10 to 20**. Every previous ID and coordinate, the pan offset and canvas bounds remained unchanged. Both documents had zero overflow and no legend. Dense local results remain reachable with panning.
- Zooming near the surrounding Bob Dylan point grew **17 to 27 artists**, including catalogued bands, collaborations and album-era peers; all previous positions remained intact. No surrounding similarity lines were added.
- Browser viewport overrides were reset after verification. The preview and measured evidence are saved as `connection-web-progressive-desktop.png`, `connection-web-progressive-narrow.png` and `connection-web-progressive-verification.json` in the task artifact folder.
