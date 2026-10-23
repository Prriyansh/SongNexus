import type { GraphEdge, GraphNode } from './data';

export interface ComparisonGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  nodeWidth: number;
  expandable: string[];
}

export const graphEdgeKey = (edge: GraphEdge) => `${edge.category}:${[edge.from, edge.to].sort().join('|')}`;
const pairKey = (a: string, b: string) => [a, b].sort().join('|');

// Group parallel records for presentation only. Every credit and source is kept
// on the selectable edge; the canonical relationship arrays remain untouched.
export function presentEdges(records: GraphEdge[], anchors: string[], path: string[], expanded: string[]): GraphEdge[] {
  const grouped = new Map<string, GraphEdge[]>();
  for (const edge of records) {
    const key = graphEdgeKey(edge);
    grouped.set(key, [...(grouped.get(key) || []), edge]);
  }
  const pathPairs = new Set(path.slice(1).map((id, i) => pairKey(path[i], id)));
  const edges = [...grouped.values()].map(group => ({
    ...group[0],
    label: [...new Set(group.map(e => e.label))].join(' · '),
    detail: group.map(e => e.detail).filter(Boolean).join(' '),
    sourceUrls: [...new Set(group.flatMap(e => e.sourceUrls || []))],
    relationships: group,
    onPath: group[0].category === 'factual' && pathPairs.has(pairKey(group[0].from, group[0].to))
  }));
  const chosen = new Map<string, GraphEdge>();
  const reached = new Set([...anchors, ...path]);
  const add = (edge: GraphEdge) => { chosen.set(graphEdgeKey(edge), edge); reached.add(edge.from); reached.add(edge.to); };
  // The actual factual path and direct factual relationships have priority.
  for (const edge of edges) if (edge.onPath || (edge.category === 'factual' && [...anchors, ...expanded].some(id => id === edge.from || id === edge.to)) || anchors.every(id => id === edge.from || id === edge.to)) add(edge);
  // A sparse discovery forest explains every other visible node without a mesh
  // of secondary edges. Expanding a node reveals its additional factual edges.
  for (const category of ['factual', 'similarity']) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) if (edge.category === category && reached.has(edge.from) !== reached.has(edge.to)) { add(edge); changed = true; }
    }
  }
  return [...chosen.values()];
}

// A horizontal factual spine with balanced satellite rows; narrow containers
// use the same structure vertically. All coordinates are world-space pixels.
export function layoutComparison(nodes: GraphNode[], edges: GraphEdge[], anchors: string[], path: string[], narrow = false): Omit<ComparisonGraph, 'expandable'> {
  const spine = path.length ? path : anchors;
  const slots = Math.max(spine.length, nodes.length > 6 ? (narrow ? 3 : 4) : 2);
  const pitchX = narrow ? 116 : 150, pitchY = 146;
  const nodeWidth = narrow ? 104 : 124;
  const positions = new Map<string, [number, number]>();
  const owner = new Map<string, number>();
  spine.forEach((id, i) => {
    const slot = Math.round(i * (slots - 1) / Math.max(1, spine.length - 1));
    positions.set(id, narrow ? [0, slot] : [slot, 0]); owner.set(id, slot);
  });
  // Assign satellites to their closest factual spine node, using similarity
  // only when no visible factual route exists.
  for (const category of ['factual', 'similarity']) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) if (edge.category === category) {
        for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) if (owner.has(a) && !owner.has(b)) { owner.set(b, owner.get(a)!); changed = true; }
      }
    }
  }
  const occupied = new Set([...positions.values()].map(p => p.join(',')));
  for (const node of nodes) if (!positions.has(node.id)) {
    const desired = owner.get(node.id) ?? (slots - 1) / 2;
    const options: { x: number; y: number; cost: number }[] = [];
    for (let depth = 1; depth <= nodes.length; depth++) for (const side of [-1, 1]) for (let slot = 0; slot < slots; slot++) {
      const [x, y] = narrow ? [side * depth, slot] : [slot, side * depth];
      if (!occupied.has(`${x},${y}`)) options.push({ x, y, cost: (depth - 1) * slots + Math.abs(slot - desired) + (side === 1 ? .05 : 0) });
    }
    options.sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x);
    const { x, y } = options[0]; positions.set(node.id, [x, y]); occupied.add(`${x},${y}`);
  }
  const xs = [...positions.values()].map(p => p[0]), ys = [...positions.values()].map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const marginX = nodeWidth / 2 + 24, marginY = 82;
  const width = (Math.max(...xs) - minX) * pitchX + marginX * 2;
  const height = (Math.max(...ys) - minY) * pitchY + marginY * 2;
  return { nodes: nodes.map(node => { const [x, y] = positions.get(node.id)!; return { ...node, x: marginX + (x - minX) * pitchX, y: marginY + (y - minY) * pitchY }; }), edges, width, height, nodeWidth };
}

export function graphFit(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return Math.min(1, Math.max(1, viewportWidth - 24) / width, Math.max(1, viewportHeight - 60) / height);
}

type Point = { x: number; y: number };
type Segment = { a: Point; b: Point };
export interface RoutedEdge { edge: GraphEdge; d: string; midpoint: Point; points: Point[]; }

// Orthogonal routing uses the gaps between node cards. This also protects the
// labels, rather than only avoiding the smaller artwork circles.
export function routeGraphEdges(graph: Omit<ComparisonGraph, 'expandable'>): RoutedEdge[] {
  const boxes = graph.nodes.map(n => ({ id: n.id, left: n.x - graph.nodeWidth / 2 - 8, right: n.x + graph.nodeWidth / 2 + 8, top: n.y - 64, bottom: n.y + 64, x: n.x, y: n.y }));
  const xs = [...new Set([12, graph.width - 12, ...boxes.flatMap(b => [b.left, b.x, b.right])])].sort((a, b) => a - b);
  const ys = [...new Set([12, graph.height - 12, ...boxes.flatMap(b => [b.top, b.y, b.bottom])])].sort((a, b) => a - b);
  const points = xs.flatMap(x => ys.map(y => ({ x, y })));
  const inside = (p: Point) => boxes.some(b => p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom);
  const blocked = points.map(inside);
  const clear = (a: Point, b: Point) => !boxes.some(box => a.x === b.x
    ? a.x > box.left && a.x < box.right && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom
    : a.y > box.top && a.y < box.bottom && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right);
  const neighbors = points.map((p, i) => {
    if (blocked[i]) return [];
    return [i - ys.length, i + ys.length, ...(i % ys.length ? [i - 1] : []), ...(i % ys.length < ys.length - 1 ? [i + 1] : [])]
      .filter(j => j >= 0 && j < points.length && !blocked[j] && clear(p, points[j]));
  });
  const used: Segment[] = [];
  const result: RoutedEdge[] = [];
  const sorted = [...graph.edges].sort((a, b) => Number(!!b.onPath) - Number(!!a.onPath) || Number(a.category === 'similarity') - Number(b.category === 'similarity'));
  for (const edge of sorted) {
    const from = boxes.find(b => b.id === edge.from)!, to = boxes.find(b => b.id === edge.to)!;
    const parallel = result.filter(r => pairKey(r.edge.from, r.edge.to) === pairKey(edge.from, edge.to)).flatMap(r => r.points.slice(1).map((b, i) => ({ a: r.points[i], b })));
    const ports = (b: typeof from) => [[b.left, b.y], [b.right, b.y], [b.x, b.top], [b.x, b.bottom]].map(([x, y]) => xs.indexOf(x) * ys.length + ys.indexOf(y));
    const goals = new Set(ports(to));
    const distance = new Map<number, number>(), previous = new Map<number, number>();
    // State includes arrival direction so turns can be penalized consistently.
    const queue: { state: number; cost: number }[] = ports(from).map(i => ({ state: i * 3, cost: 0 }));
    queue.forEach(q => distance.set(q.state, 0));
    let finish: number | undefined;
    while (queue.length) {
      queue.sort((a, b) => b.cost - a.cost);
      const current = queue.pop()!;
      if (current.cost !== distance.get(current.state)) continue;
      const i = Math.floor(current.state / 3), direction = current.state % 3;
      if (goals.has(i)) { finish = current.state; break; }
      for (const j of neighbors[i]) {
        const a = points[i], b = points[j], nextDirection = a.x === b.x ? 1 : 2;
        const interference = [...used, ...parallel].reduce((cost, s) => {
          const vertical = a.x === b.x, otherVertical = s.a.x === s.b.x;
          if (vertical === otherVertical) {
            const overlap = vertical ? a.x === s.a.x && Math.max(Math.min(a.y, b.y), Math.min(s.a.y, s.b.y)) < Math.min(Math.max(a.y, b.y), Math.max(s.a.y, s.b.y))
              : a.y === s.a.y && Math.max(Math.min(a.x, b.x), Math.min(s.a.x, s.b.x)) < Math.min(Math.max(a.x, b.x), Math.max(s.a.x, s.b.x));
            // Parallel categories must remain independently visible/selectable.
            return cost + (overlap ? (parallel.includes(s) ? 600 : 16) : 0);
          }
          const v = vertical ? { a, b } : s, h = vertical ? s : { a, b };
          return cost + (v.a.x > Math.min(h.a.x, h.b.x) && v.a.x < Math.max(h.a.x, h.b.x) && h.a.y > Math.min(v.a.y, v.b.y) && h.a.y < Math.max(v.a.y, v.b.y) ? 32 : 0);
        }, 0);
        const cost = current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (direction && direction !== nextDirection ? 18 : 0) + interference;
        const state = j * 3 + nextDirection;
        if (cost < (distance.get(state) ?? Infinity)) { distance.set(state, cost); previous.set(state, current.state); queue.push({ state, cost }); }
      }
    }
    if (finish === undefined) continue; // No off-canvas fallback through labels.
    const route: Point[] = [];
    for (let state: number | undefined = finish; state !== undefined; state = previous.get(state)) route.unshift(points[Math.floor(state / 3)]);
    for (let i = 1; i < route.length; i++) used.push({ a: route[i - 1], b: route[i] });
    // Collinear grid points collapse to a short, gently rounded SVG path.
    const corners = route.filter((p, i) => !i || i === route.length - 1 || (route[i - 1].x === p.x) !== (p.x === route[i + 1].x));
    let d = `M ${corners[0].x} ${corners[0].y}`;
    for (let i = 1; i < corners.length; i++) {
      const p = corners[i], before = corners[i - 1], after = corners[i + 1];
      if (!after) { d += ` L ${p.x} ${p.y}`; continue; }
      const r = Math.min(8, Math.hypot(p.x - before.x, p.y - before.y) / 2, Math.hypot(after.x - p.x, after.y - p.y) / 2);
      const approach = { x: p.x + Math.sign(before.x - p.x) * r, y: p.y + Math.sign(before.y - p.y) * r };
      const exit = { x: p.x + Math.sign(after.x - p.x) * r, y: p.y + Math.sign(after.y - p.y) * r };
      d += ` L ${approach.x} ${approach.y} Q ${p.x} ${p.y} ${exit.x} ${exit.y}`;
    }
    result.push({ edge, d, midpoint: route[Math.floor(route.length / 2)], points: route });
  }
  return result;
}
