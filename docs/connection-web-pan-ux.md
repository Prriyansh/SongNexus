# Connection Web: stable pan and UX testing

The [spatial zoom update](connection-web-spatial-zoom.md) adds animated camera scaling while preserving world coordinates and stable pan membership. The directional pad and visible drag/zoom hint were subsequently removed at the user's request; keyboard, wheel and drag navigation remain. The measurements below describe the earlier pan implementation.

## Plan, written before implementation

1. Reproduce dragging at overview and detail zoom, including short reversals near viewport edges. Inspect artist identity and placement changes, pointer capture, hover states, late catalog updates, and rendering cost.
2. Replace per-pointer-move artist re-ranking with persistent world-space detail membership. Keep a stable, nested ordering within spatial regions: a few varied representatives at overview, then more nearby artists at higher zoom. Panning must only translate that map and cull points beyond an offscreen buffer.
3. Preserve existing membership when metadata arrives; defer catalog presentation updates during a drag. Keep pointer capture reliable, distinguish a click from a drag, clear drag hover effects, and cancel cleanly on pointer cancellation, capture loss and window blur. Keep visible counts accurate despite the offscreen buffer.
4. Add regression tests for repeated small pans, reverse pans, boundary crossings, late data, nested zoom levels and pointer lifecycle. Test the complete user journeys, including zoom, pan buttons, keyboard controls, artist drawers and reset.
5. Run unit/integration tests, lint, TypeScript and a production build. Use real browser input to verify Search and Comparison at desktop and narrow sizes. Record artist IDs/coordinates around drag gestures and confirm no interior artists disappear, no page scrolling occurs, and no legends appear. Save screenshots and measured evidence.

## Implementation prompt

Fix the underlying cause of flickering artists while panning Connection Web. The current viewport sampler re-ranks candidates on every camera update and clips them at a strict viewport boundary; small pointer movements can replace visible artists. Do not mask this with an opacity animation or merely postpone the same re-ranking until pointer-up.

Make artist membership stable in world coordinates at a given zoom. Build and retain a deterministic spatial detail index whose existing entries are not reordered by panning or late catalog responses. Keep overview representatives musically varied and zoom-in detail denser and nested. Apply viewport culling with enough overscan to mount incoming points before they reach the visible edge and unmount them after they leave. An artist visible in the overlapping region of two pan positions must retain its DOM identity, coordinates, artwork and label. Panning must continue to reveal surrounding points; do not freeze navigation or display the entire cached pool at every zoom.

Keep avatar sizes fixed, preserve documented connection lines, and retain the viewport-sized non-scrolling layout and absence of legends. Use the actual visible artist count in the toolbar, excluding buffered offscreen points. Resolve pointer capture and click suppression so dragging an avatar pans without opening its drawer, while an ordinary click still opens artist details. Queue catalog presentation changes during a drag and apply them without replacing existing detail members afterward. Avoid unnecessary catalog calls during pan and unnecessary sorting during pointer movement.

## UX test prompt

Test the completed interaction rather than only a screenshot. At overview and detail zoom, drag in several directions, reverse across boundaries and repeat small movements. Track artist IDs and pixel positions: points that stay inside the visible map must never disappear, and all common points must translate by the same camera delta. Confirm nearby points enter from the edges instead of replacing interior points. Verify pan buttons, horizontal/shift-wheel panning, keyboard panning, zoom-out/zoom-in detail, reset, an ordinary artist click, an avatar-origin drag, cancellation and late discovery data. Repeat in Search and Comparison and at desktop and narrow viewport sizes. Check actual viewport counts, documented lines, zero document overflow and no legends. Report observed results and concrete remaining limitations; do not claim subjective user testing or frame-rate measurements that were not performed.

## Implementation and observed results

The new detail index assigns persistent tiers within world-space regions. Adjacent representatives favor different musical styles; higher zoom reveals a longer prefix of each region's retained members. Panning does not re-rank members. A 140–200px offscreen buffer keeps points mounted while they enter or leave the viewport. New catalog results append to existing tiers and are presented after a drag ends. Camera movement uses a composited transform and batches rapid input into animation frames.

Before the fix, each of four real short/reverse browser drags replaced one artist whose avatar was still inside the map. The regression also failed at both overview and detail zoom.

After the fix, the final browser matrix covered **48 real drag gestures** across eight scenarios: Search and Comparison, overview and detail, at **1440 × 900** and the native **474 × 695** viewport. No interior artists disappeared. All common points translated with the camera, with measurement error below **0.001px**. Counts matched visible avatar centers in every recorded gesture, all gestures ended cleanly, and document overflow and scroll offsets stayed zero.

| Mode | Viewport | Overview artists | Detail artists |
| --- | --- | ---: | ---: |
| Search | 1440 × 900 | 7 | 30 |
| Comparison | 1440 × 900 | 8 | 21 |
| Search | 474 × 695 | 3 | 8 |
| Comparison | 474 × 695 | 4 | 7 |

These are observed counts in the same camera region, not fixed limits. Points may naturally enter or leave at the viewport edges; cached detail can also arrive after a completed gesture.

- Live avatar dragging panned without opening a drawer; the following ordinary click opened Artist details. Closing it retained the page's viewport lock.
- Live keyboard panning moved 40px, directional controls moved 110px, horizontal wheel input panned without changing zoom, and reset restored zero pan and 100% zoom.
- Buffered offscreen artists have no keyboard tab stops. Starting an avatar drag focuses the map; a subsequent arrow key pans without needing another click. This was verified in the browser and regression tests.
- Regression tests retain the actual artist elements and artwork through 80 small/reverse pointer movements. Additional tests cover offscreen entry/exit, late catalog updates, pointer cancellation, capture loss, blur, Escape, drag click suppression, zoom/pan overlap and accurate counts.
- A rapid-input test confirms 100 pointer moves share one pending animation frame and that release flushes the final position. This is an input-coalescing check, not a hardware frame-rate benchmark.
- **244 tests passed**. Production build, TypeScript and ESLint passed. The clean browser session logged no new errors or warnings. No legends were introduced; temporary viewport overrides were reset.
- Evidence is saved in the task artifact folder: `connection-web-pan-ux-verification.json`, `connection-web-pan-ux-desktop.png`, `connection-web-pan-ux-search-desktop.png` and `connection-web-pan-ux-narrow.png`.

Verification used scripted browser interactions and React DOM regression tests, rather than a participant usability study. Interior-drop checks used avatar centers that remained at least 10px inside the visible map; the automated boundary and overscan tests also cover edge crossings.
