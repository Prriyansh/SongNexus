# Connection Web: implementation prompt and plan

## Detailed implementation prompt

Extend the existing Song Nexus React/Next.js frontend with a dedicated Connection Web destination between About Me and Explore in the sidebar. Preserve the current dark Song Nexus branding, existing Explore comparisons, music profile, data APIs, and details drawer. Interpret the supplied sketch as a layout and interaction reference; never render its red annotations.

Make the artist network the dominant workspace. Put a Search / Comparison segmented control at the upper right and music selection controls in a dock at the bottom. Render circular artist avatars with names and short genre or role captions. Clicking any avatar must immediately open artist information, including the existing albums, genres, links, and taste actions. Support pointer panning, keyboard panning, content zoom, and reset. Keep the experience usable on narrow screens and with keyboard navigation. Do not include a legend, a “Find a connection” heading or icon, “Musical neighborhood” or “Across genres” badges, or an idle Search Mode status sentence.

Comparison mode accepts two distinct artists. Connect them only through documented credits, musical relationships or a shared band/member from MusicBrainz. Keep all surrounding discovery artists unlinked, even when they share genre tags. Similarity alone is enough to include an artist in the surrounding map. The initial content scope depends on musical distance: nearby styles show a focused set; distant styles such as folk and J-pop include artists from intermediate styles. Zooming in adds more matches near the pointer, including neighborhoods of surrounding artists; zooming out discovers increasingly diverse neighboring styles. Keep avatar and label sizes fixed at every level. Retain every loaded artist and its position during zoom. See [the progressive discovery prompt](connection-web-progressive-discovery.md) for the current zoom behavior and additional similarity signals.

Use a flat, open canvas with deterministic, scattered artist positions and room between avatars and labels. Drag in any direction, including starting a drag over an artist, to explore surrounding points; a drag must not open artist details. Support directional pan controls and keyboard panning. Zoom around the pointer on mouse-wheel or trackpad scroll without scrolling the page. Horizontal or Shift-scroll pans sideways. Preserve the camera while new results arrive, and provide a reset to return to the initial view. Keep clicks on avatars opening details.

Search mode accepts one song. Show its performers and similar artists discovered from the song's and lead artist's styles, with the same content zoom. Use actual search results and stable MusicBrainz identifiers. Genre similarity affects discovery and ranking only; never draw similarity edges or a synthetic artist path. If no documented artist connection exists, leave the surrounding artists unlinked. Search Mode shows status only while loading or when an error needs attention.

Use the existing server proxy for all catalog requests. Bound discovery requests and node counts, handle partial results, and provide loading, empty, retry, and upstream error states. Encode mode and selections in shareable URLs, support refresh and browser back/forward, and preserve the user's Connection Web choices while visiting other navigation destinations. Verify genre-distance scope, truthful edges, single-song search, immediate avatar details, navigation, sharing, and existing behavior.

## Execution plan

1. Read local Next.js client-component and rewrite documentation and inspect the current graph, routing, APIs, styles, drawer, and tests.
2. Extract the reusable catalog picker. Add independent Connection Web URL state and a rewrite; integrate navigation and sharing without changing existing Explore URLs.
3. Implement genre-neighborhood routing, bounded catalog discovery, deduplication, similarity ranking, and four content scopes. Cache individual style searches across scopes and preserve existing results while additional styles load. Keep only documented path edges.
4. Build the map canvas and workspace with the two modes, selection dock, genre trail, direct artist details, scattered placement, a persistent 2D camera, pointer-centered scroll zoom, drag and directional panning, reset, fixed avatar sizes, responsive layout, and progressive data states.
5. Add model and integration coverage for changing artist identities and genre diversity across zoom levels, fixed card sizes, pointer anchoring, camera persistence, scroll interception, deterministic scattered placement, absence of context edges and removed labels, direct artist details, navigation, and sharing. Run the existing suite, TypeScript validation, and production build, then inspect the local browser experience and correct observed issues.

## Data limits

The genre topology is an editorial discovery aid, not a measured similarity score. Credit coverage is limited to the existing album scan. Genre search can return incomplete or unavailable results; the UI must retain useful selections and available artists and identify incomplete discovery. Album artwork and initials remain the existing artist-avatar fallbacks; do not invent portraits.
