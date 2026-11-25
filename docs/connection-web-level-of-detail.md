# Zoom-dependent artist detail

The [pan UX update](connection-web-pan-ux.md) replaces per-movement viewport re-ranking with stable world-space detail tiers and buffered culling. Zoom-dependent density and cache retention still apply; the measurements below describe the earlier implementation.

## Execution prompt

Separate the cached artist pool from the artists displayed at the current zoom. Zooming out must show a small, diverse set of representatives, never the entire accumulated pool. Zooming in must display more artists within the same canvas region, prioritizing nearby points around the pointer or map center. Retain the cache and stable world coordinates so zooming back in restores detail without refetching or randomly repositioning points. Keep the selected artists and documented path available at every level; surrounding similarity points remain unlinked. Do not add legends.

Choose overview representatives using musical variety and spatial coverage. Derive the detail budget from zoom and available viewport area so the narrow layout also shows fewer overview points than detail points. Sample points that are actually in the viewport, rather than counting offscreen cached artists as displayed detail. Keep cards at a constant size, use scattered placement, and retain flat pan navigation with wheel zoom and no document scrolling. Panning must update the visible sample for the new region. Zoom-in may fetch more similar artists around any visible context artist using the existing source-backed neighborhood endpoint.

## Plan

1. Add a pure viewport detail selector: a sparse, diverse overview plus progressively more nearby points as zoom increases.
2. Keep all cached positions in the canvas, but render only the selected detail set and report its visible count. Always retain documented path nodes for truthful edges.
3. Use compact scattered world placement so additional detail can occupy the viewport, rather than making the extra artists exist only offscreen.
4. Update regression tests to compare actual in-viewport counts across zoom levels, verify musical variety and cache restoration, and check focus selection, panning, lines and the absence of legends.
5. Run tests, lint and a production build; verify real wheel zoom-out/zoom-in in the browser and save before/after evidence.

This replaces the previous requirement to keep every cached artist displayed at every zoom. Cache retention and visible detail are now separate.

## Verified result

- `web-detail.ts` renders a sparse sample of 3–7 representatives at overview zoom, then progressively adds nearby points as zoom increases. The budget adapts to viewport area; the selected artists and documented path stay available.
- Cached points keep their world coordinates. Compact scattered placement makes detail points available inside the viewport. Re-entering a zoom level reuses cached detail instead of increasing the discovery budget for every wheel gesture.
- Actual browser measurements, counting avatar centers inside the same viewport region:

| Browser viewport | Overview | Detail | Returned to overview |
| --- | ---: | ---: | ---: |
| 1440 × 900 | 7 | 29 | 7 |
| 474 × 695 | 3 | 7 | 3 |

- The desktop overview included Pop, Dance-Pop, Synth-Pop, Folk Rock, Art Pop, K-Pop and Dream Pop. Higher zoom showed additional points within the same canvas bounds. Common artist coordinates and the pan offset remained unchanged.
- Panning selected different surrounding points without moving the webpage. All measured states had zero page overflow and scroll offset; no legend appeared. Temporary viewport overrides were reset.
- Validation: **229 tests passed**, production build and TypeScript passed, and ESLint passed for the changed implementation and tests.
- Evidence: `connection-web-overview-desktop.png`, `connection-web-detail-desktop.png`, narrow-screen equivalents, and `connection-web-level-of-detail-verification.json` in the task artifact folder.
