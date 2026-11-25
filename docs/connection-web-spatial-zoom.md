# Spatial zoom: plan and execution prompts

## Plan, written before implementation

1. Audit the camera, detail tiers, discovery placement and SVG edges. Preserve stable pan membership, click/drag handling, keyboard access and the non-scrolling page.
2. Use one world-to-screen camera for every artist and connection. Zoom around the mouse pointer; zoom buttons use the canvas center. The distance between any two retained artist centers must scale with zoom. Keep avatar and label sizes fixed for readability.
3. Animate camera changes, move the existing grid with the same scale, and synchronize connection endpoints with artist centers. Preserve the world point under the pointer and support interruption by drag, reset or other input. Respect reduced motion.
4. Make detail visibility continuous: fade tiers as their zoom threshold is crossed, retain outgoing points through the fade, and introduce asynchronously loaded artists with a short fade at their stable world positions. Do not add legends or arbitrary repositioning.
5. Place newly discovered close-detail artists at the current world-space resolution so zoom-in can reveal finer neighborhoods between existing points. Keep their positions cached afterward. Convert focus, viewport culling, hit testing, keyboard tab order and counts through the same camera.
6. Test pair-distance ratios, pointer anchoring, line endpoints, animation intermediate frames, fade continuity, local density, drag stability, wheel/drag overlap, clicks and reset. Run the full suite, lint, TypeScript and production build. Use real browser zoom and drag in both modes and responsive sizes, and save measurements and screenshots.

## Implementation prompt

Give Connection Web a visible sense of scale. Zoom-in must spread the two compared artists and surrounding points farther apart; zoom-out must bring them closer together. Use persistent world coordinates and a single affine camera, not a layout recalculation. Project avatar centers, documented lines and the background grid consistently. Keep avatar/label pixel sizes fixed. The displayed percentage is camera zoom, not a measured musical-similarity score.

Anchor wheel zoom to the pointer and button zoom to the map center. Animate the camera so retained points visibly travel between scales. When zoom is interrupted, begin the next interaction from the current displayed camera rather than jumping to a pending target. Preserve drag capture, input coalescing, accurate world-space discovery focus and reset behavior.

Keep the sparse, varied overview and denser focused detail. Reveal detail tiers progressively with opacity, including a fade for newly loaded artists; fade outgoing tiers before hiding them. Points must appear at stable, geometrically meaningful locations rather than being moved to new random positions. Render with an offscreen buffer and keep pan membership stable. Newly discovered close-detail points need appropriately finer world spacing, so physical zoom does not merely empty the viewport. Only actual documented connections get lines. Do not add a legend.

## Verification prompt

Compare the same artist pair at several zoom values after motion settles. Their screen-distance ratio must equal the camera-zoom ratio, while avatar dimensions remain constant. Check intermediate animation frames, pointer anchoring and line attachment. Confirm the grid provides the same spatial reference. Track alpha through detail thresholds and reverse zoom to verify fades without sudden removal. Test new discoveries, overview variety and greater local detail where catalog matches are available. Repeat small/reverse drags to guard against flicker, test wheel/drag overlap, keyboard controls, ordinary clicks, avatar drags and reset. Check Search and Comparison at desktop and narrow sizes, zero page overflow, no legends and clean console output. Record actual observed results without claiming unperformed human studies or frame-rate benchmarks.

## Follow-up UI instruction

Remove the directional pan pad and the visible “Drag to pan · zoom in to discover nearby artists” hint, including their icons and obsolete CSS. Retain dragging, keyboard panning and the zoom controls. Verify their removal in the running frontend.

## Execution and verification

Implemented one animated world-to-screen camera for artists, documented connection lines and the grid. Retained artists move continuously as zoom changes, while avatar pixel sizes stay fixed. Detail tiers fade at their stable positions, and new focused discoveries use finer world spacing. Removed the directional pan pad and visible instruction hint.

Browser measurements confirmed the Comparison pair distance changed from 716.64 px at 100% to 444.31 px at 62% and 967.46 px at 135% (ratios 0.6200 and 1.3500). Anchor avatars remained 68 px. Pointer-anchored wheel zoom drift was 0.29 px. Intermediate opacity readings confirmed partially visible artists during tier transitions. The desktop Comparison overview showed 4 artists; focused detail showed 16 initially and 24 after discovery completed. Search also showed more focused detail than its overview.

Twelve scaled drag checks across desktop Comparison, desktop Search and narrow Search recorded no interior artist removals, no document scrolling and less than 0.001 px translation disagreement. Fresh desktop and narrow screenshots confirm the pan pad, hint and legends are absent. The final browser console check contained no warnings or errors, and the viewport override was reset to its native size.

Validation: the full suite passed 250 tests; follow-up app/canvas checks passed 54 tests, and the final canvas run passed 15 tests. TypeScript, targeted ESLint, production build and whitespace checks passed. These results cover automated checks and scripted browser interactions, not a human usability study or frame-rate benchmark. Measurements and previews are saved as `connection-web-spatial-zoom-verification.json` and matching PNGs in the session artifact directory.
