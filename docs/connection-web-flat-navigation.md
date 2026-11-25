# Connection Web: viewport canvas prompt and execution plan

## Implementation prompt

Fix the existing Connection Web so it is a flat, viewport-sized application surface, not a map embedded in a scrolling webpage. The current wheel handler works over the canvas, but the hero, minimum map height, selection dock, and footer still make the document taller than the window. Fix that layout contract rather than adding another wheel handler.

On `/connections` only, constrain the entire app shell to the dynamic viewport in both dimensions. Prevent document scrolling and overscroll. Keep the global navigation and top bar, compact Connection Web title and mode switch, selected music, map controls, status when necessary, and bottom music pickers visible simultaneously. The canvas must flex into the remaining height with a zero minimum height; remove the 500px map minimum from this route. Do not put a footer or promotional hero above or below the canvas. Adapt compact chrome for small and short windows rather than creating an outer scrollbar.

Keep the map as one continuous 2D plane: drag or use directional controls to pan, scroll over it to zoom around the pointer, and reset the camera with the existing reset control. Keep scattered artist positions, fixed-size avatars, similarity-based discovery, and documented connection lines. Data updates must preserve the camera. Do not use native element scrolling as map navigation.

Page-level wheel, touch, Page Down, End, or arrow scrolling must never move the Connection Web document. Artist details and catalog result lists may scroll internally when their contents require it. Keep these panels inside viewport bounds and contain their scrolling. Opening and closing them must preserve the document lock. Navigating away to About Me or Explore must restore those pages' existing normal scrolling.

Do not treat `preventDefault()` on a canvas wheel event or passing jsdom tests as proof of this fix. Verify actual browser layout and real scrolling attempts at desktop, phone, and short landscape sizes in Search and Comparison modes. The document's `scrollHeight` and `scrollWidth` must be no greater than its client viewport dimensions (allowing one pixel rounding); `scrollTop` and `scrollLeft` must stay zero. Confirm the map and bottom selectors are inside the viewport, a real canvas wheel changes zoom without moving the document, and real dragging changes the camera. Check that details and pickers remain usable and other destinations regain normal document scrolling.

## Execution plan

1. Inspect the app shell and map sizing to identify every source of document overflow.
2. Add a Connection Web shell state and route-scoped viewport constraints; omit its page footer.
3. Compact the heading and arrange the workspace as a bounded flex column with a flexible canvas and a fixed bottom selection dock. Add responsive rules for short windows and bounded popovers.
4. Preserve map camera interactions and ensure focus or overflow cannot introduce native canvas scrolling.
5. Add route and lifecycle regression checks. Run the relevant tests, TypeScript check, and production build.
6. Use the real browser to measure viewport/document geometry and attempt page scrolling outside the canvas, canvas zoom, drag panning, and navigation to another destination. Repeat in Search and Comparison on desktop, phone, and short landscape layouts. Save the measured results and a preview; report completion only after these checks pass.

## Verification results

| Browser viewport | Search | Comparison | Document dimensions |
| --- | --- | --- | --- |
| 1440 × 900 | Passed | Passed | 1440 × 900 |
| 390 × 844 | Passed | Passed | 390 × 844 |
| 844 × 390 | Passed | Passed | 844 × 390 |
| 320 × 568 | Passed | Passed | 320 × 568 |
| 320 × 360 | Passed | Passed | 320 × 360 |
| Native app: 474 × 695 | Passed | — | 474 × 695 |

- All 22 recorded Connection Web states had zero document scroll offsets and no document overflow. Map, pan/zoom controls, and bottom pickers stayed inside the viewport.
- Real wheel scrolling over the header, Page Down, and End did not move the page. Scrolling over the map changed discovery scope while the avatar width stayed constant.
- Real pointer dragging moved the map camera by 45px horizontally and 34px vertically without moving the document.
- Picker results scrolled internally to 360px, and artist details scrolled internally to 288.8px; the document stayed at zero. Closing details kept the viewport constraint active.
- Explore regained normal document flow and scrolled to 1697.6px. Returning to Connection Web restored a viewport-sized document at scroll position zero. About Me also regained normal document flow.
- The complete unit/integration suite passed: 210 tests. These tests supplement the browser measurements; they are not used as a substitute for layout verification.
