// Helen's zoom-dependent detail (docs/connection-web-level-of-detail.md and connection-web-spatial-zoom.md),
// on the similarity map. Zoomed out shows a small, varied set; zooming in reveals more, most of all
// around the focus. Which cell a node belongs to is fixed in world space, so panning never re-ranks.
import type { WebNode } from './similar-web';
import type { MapPoint, WebCamera } from './web-navigation';

type Viewport = { width: number; height: number; camera: WebCamera };
type DetailCell = { column: number; row: number; ids: string[] };
export type WebDetailIndex = { width: number; height: number; columns: number; rows: number; cells: Map<string, DetailCell>; overview: Map<string, string> };
/** Where the camera is looking: the world point under the pointer, and the artist nearest it. */
export type WebFocus = MapPoint & { nodeId: string | null };
type DetailViewport = Viewport & { focus?: WebFocus | null; index?: WebDetailIndex };

/** What counts as "the same kind of music" for variety: an artist's top tag, a song's artist. */
const style = (node: WebNode) => `${node.kind}:${(node.kind === 'song' ? node.artist ?? node.subtitle : node.subtitle).toLowerCase()}`;
/** Artists added by zooming in only appear once the camera is close again. */
const depthOf = (node: WebNode) => node.discoveryZoom ?? 1;

/** Cells keep their members as nodes are added: pass the previous index for the same map size. */
export function buildWebDetailIndex(nodes: WebNode[], width: number, height: number, previous?: WebDetailIndex | null): WebDetailIndex {
  const columns = width >= 800 ? 3 : 2, rows = height >= 500 ? 2 : 1;
  const cellWidth = width / columns, cellHeight = height / rows;
  const available = new Map(nodes.filter(n => !n.isCenter).map(n => [n.id, n]));
  const cells = new Map<string, DetailCell>();
  const indexed = new Set<string>();
  if (previous?.width === width && previous.height === height) for (const [key, cell] of previous.cells) {
    const ids = cell.ids.filter(id => available.has(id));
    cells.set(key, { ...cell, ids });
    for (const id of ids) indexed.add(id);
  }
  const additions = new Map<string, { column: number; row: number; nodes: WebNode[] }>();
  for (const node of available.values()) {
    if (indexed.has(node.id)) continue;
    const column = Math.floor(node.x / cellWidth), row = Math.floor(node.y / cellHeight), key = column + ':' + row;
    if (!additions.has(key)) additions.set(key, { column, row, nodes: [] });
    additions.get(key)!.nodes.push(node);
  }
  for (const [key, batch] of [...additions].sort((a, b) => a[1].row - b[1].row || a[1].column - b[1].column)) {
    const cell = cells.get(key) ?? { column: batch.column, row: batch.row, ids: [] };
    const candidates = [...batch.nodes];
    const ownStyles = new Set(cell.ids.map(id => style(available.get(id)!)));
    const neighborStyles = [...cells.values()].filter(c => Math.abs(c.column - cell.column) <= 1 && Math.abs(c.row - cell.row) <= 1)
      .flatMap(c => c.ids[0] ? [style(available.get(c.ids[0])!)] : []);
    while (candidates.length) {
      // Variety first, then closeness to the selection, then a spot near the cell's middle.
      const score = (n: WebNode) => {
        const distance = Math.hypot(n.x / cellWidth - cell.column - .5, n.y / cellHeight - cell.row - .5);
        return (ownStyles.has(style(n)) ? 0 : 2) - (!cell.ids.length ? neighborStyles.filter(g => g === style(n)).length * 3 : 0)
          + n.similarity * 1.5 - distance * .5;
      };
      candidates.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
      const next = candidates.shift()!;
      cell.ids.push(next.id); ownStyles.add(style(next));
    }
    cells.set(key, cell);
  }
  const overview = new Map<string, string>();
  if (previous?.width === width && previous.height === height) for (const [key, id] of previous.overview) {
    if (available.has(id)) overview.set(key, id);
  }
  const parentCandidates = new Map<string, string[]>();
  for (const cell of cells.values()) {
    const id = cell.ids.find(id => depthOf(available.get(id)!) <= 1);
    if (!id) continue;
    const key = Math.floor(cell.column / 2) + ':' + Math.floor(cell.row / 2);
    parentCandidates.set(key, [...(parentCandidates.get(key) ?? []), id]);
  }
  const usedStyles = new Set([...overview.values()].map(id => style(available.get(id)!)));
  for (const [key, ids] of parentCandidates) {
    if (overview.has(key)) continue;
    const next = ids.map(id => available.get(id)!).sort((a, b) => Number(usedStyles.has(style(a))) - Number(usedStyles.has(style(b))) || b.similarity - a.similarity || a.id.localeCompare(b.id))[0];
    overview.set(key, next.id); usedStyles.add(style(next));
  }
  return { width, height, columns, rows, cells, overview };
}

/** Opacity for every node: outgoing tiers keep a value through their fade, and panning never re-ranks members. */
export function webDetailOpacity(nodes: WebNode[], viewport: DetailViewport): Map<string, number> {
  const { width, height, camera, focus } = viewport;
  const index = viewport.index ?? buildWebDetailIndex(nodes, width, height);
  const core = nodes.filter(n => n.isCenter);
  const opacity = new Map(core.map(n => [n.id, 1]));
  const lookup = new Map(nodes.map(n => [n.id, n]));
  const capacity = Math.max(core.length + 2, Math.min(36, Math.floor(width * height / (132 * 124))));
  const overviewBudget = Math.max(core.length + 1, Math.min(7, Math.max(3, Math.floor(capacity * .2))));
  const density = Math.max(.18, Math.min(.9, .18 + (camera.zoom - .62) * .55));
  const budget = Math.max(overviewBudget, capacity * density);
  // A zoomed viewport covers less world area; finer tiers compensate for that area change.
  const slots = Math.max(1, (budget - core.length) / (index.columns * index.rows)) * Math.max(1, camera.zoom ** 2);
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  // The fallback is fixed in world space. It must not follow the camera during pan.
  const focal = focus ?? { x: width / 2, y: height / 2 };
  const representatives = new Set(index.overview.values());
  const childDetail = clamp((camera.zoom - .68) / .32);
  for (const cell of index.cells.values()) {
    const nearFocus = Math.hypot(focal.x * index.columns / width - cell.column - .5, focal.y * index.rows / height - cell.row - .5) <= .85;
    const count = slots + (nearFocus ? clamp((camera.zoom - 1) / .3) : 0);
    const ranks = new Map<number, number>();
    for (const id of cell.ids) {
      const node = lookup.get(id);
      if (!node) continue;
      const depth = depthOf(node);
      const rank = ranks.get(depth) ?? 0; ranks.set(depth, rank + 1);
      const detail = depth <= 1 ? 1 : clamp((camera.zoom - Math.max(1.08, depth * .8)) / Math.max(.12, depth * .15));
      const tier = depth <= 1 && rank === 0 ? representatives.has(id) ? 1 : childDetail : clamp(count - rank) * (depth <= 1 ? childDetail : 1);
      opacity.set(id, Math.min(tier, detail));
    }
  }
  return opacity;
}

/** The world point under a screen point, and the nearest artist on show there (never the center): what zooming in explores. */
export function focusAt(nodes: WebNode[], point: MapPoint, camera: WebCamera): WebFocus {
  const world = { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
  const nearest = nodes.filter(n => n.kind === 'artist' && !n.isCenter)
    .map(n => ({ n, distance: Math.hypot(n.x - world.x, n.y - world.y) }))
    .sort((a, b) => a.distance - b.distance || a.n.id.localeCompare(b.n.id))[0];
  return { ...world, nodeId: nearest?.n.id ?? null };
}
