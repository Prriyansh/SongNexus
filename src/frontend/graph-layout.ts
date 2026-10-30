import type { EntityType } from './types';

export interface GraphNode {
  id: string;
  entityType: EntityType;
  label: string;
  subtitle: string;
  x: number;
  y: number;
  role?: string; // 'Comparison anchor' for the two selected nodes.
  contributor?: boolean;
  artUrl?: string | null;
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
  /** A songwriting credit alone: true, but not evidence the two worked together. */
  writingOnly?: boolean;
  relationships?: GraphEdge[]; // Underlying records for a grouped visible edge.
}

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

// Columns from left to right along the factual path, with everyone else stacked in the column
// between the people they connect. All coordinates are world-space pixels.
export function layoutComparison(nodes: GraphNode[], edges: GraphEdge[], anchors: string[], path: string[], narrow = false): Omit<ComparisonGraph, 'expandable'> {
  const spine = path.length ? path : anchors;
  const pitchX = narrow ? 128 : 230, pitchY = 124;
  const nodeWidth = narrow ? 104 : 124;
  const column = new Map<string, number>();
  // Two anchors with people to place leave a column free between them.
  const stride = spine.length === 2 && nodes.length > 2 ? 2 : 1;
  spine.forEach((id, i) => column.set(id, i * stride));
  for (const category of ['factual', 'similarity']) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) if (!column.has(node.id)) {
        const linked = edges.filter(e => e.category === category && (e.from === node.id || e.to === node.id))
          .flatMap(e => column.get(e.from === node.id ? e.to : e.from) ?? []);
        if (linked.length) { column.set(node.id, Math.round(linked.reduce((sum, c) => sum + c, 0) / linked.length)); changed = true; }
      }
    }
  }
  const columns = Math.max(...column.values(), 0);
  // Stack each column outward from the middle row, keeping the path itself straight.
  const rows = new Map<string, number>();
  const used = new Map<number, number>();
  for (const id of spine) rows.set(id, 0);
  for (const node of nodes) if (!rows.has(node.id)) {
    const c = column.get(node.id) ?? Math.round(columns / 2);
    column.set(node.id, c);
    const taken = (used.get(c) ?? 0) + 1;
    used.set(c, taken);
    const hasMiddle = spine.some(id => column.get(id) === c);
    const slot = hasMiddle ? taken : taken - 1;
    rows.set(node.id, slot % 2 ? -(slot + 1) / 2 : slot / 2);
  }
  const allRows = [...rows.values()];
  const minRow = Math.min(...allRows), maxRow = Math.max(...allRows);
  const marginX = nodeWidth / 2 + 24, marginY = 96;
  return {
    nodes: nodes.map(node => ({ ...node, x: marginX + column.get(node.id)! * pitchX, y: marginY + (rows.get(node.id)! - minRow) * pitchY })),
    edges,
    width: columns * pitchX + marginX * 2,
    height: (maxRow - minRow) * pitchY + marginY * 2,
    nodeWidth,
  };
}

export function graphFit(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return Math.min(1, Math.max(1, viewportWidth - 24) / width, Math.max(1, viewportHeight - 60) / height);
}

type Point = { x: number; y: number };
export interface RoutedEdge { edge: GraphEdge; d: string; midpoint: Point; points: Point[]; }

const CARD_HALF_HEIGHT = 62;
const cubicMidpoint = (a: Point, c1: Point, c2: Point, b: Point): Point => ({ x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 });

// Curves from card edge to card edge. Neighbouring columns never cross a card; a line that skips a
// column arcs over the top (credits) or under the bottom (shared genres) of the whole graph.
export function routeGraphEdges(graph: Omit<ComparisonGraph, 'expandable'>): RoutedEdge[] {
  const half = graph.nodeWidth / 2;
  const lookup = new Map(graph.nodes.map(n => [n.id, n]));
  const xs = [...new Set(graph.nodes.map(n => n.x))].sort((a, b) => a - b);
  const pitch = xs.length > 1 ? xs[1] - xs[0] : 0;
  const sorted = [...graph.edges].sort((a, b) => Number(!!b.onPath) - Number(!!a.onPath) || Number(a.category === 'similarity') - Number(b.category === 'similarity'));
  return sorted.flatMap(edge => {
    const from = lookup.get(edge.from), to = lookup.get(edge.to);
    if (!from || !to) return [];
    const [left, right] = from.x <= to.x ? [from, to] : [to, from];
    const curve = (a: Point, c1: Point, c2: Point, b: Point): RoutedEdge =>
      ({ edge, d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`, midpoint: cubicMidpoint(a, c1, c2, b), points: [a, b] });
    if (left.x === right.x) {
      // Same column: bow out to the side.
      const x = left.x + half, bow = x + 34;
      return [curve({ x, y: left.y }, { x: bow, y: left.y }, { x: bow, y: right.y }, { x, y: right.y })];
    }
    if (right.x - left.x > pitch * 1.5) {
      const over = edge.category !== 'similarity';
      const edgeY = over ? 14 : graph.height - 14;
      const sign = over ? -1 : 1;
      const a = { x: left.x, y: left.y + sign * CARD_HALF_HEIGHT }, b = { x: right.x, y: right.y + sign * CARD_HALF_HEIGHT };
      return [curve(a, { x: left.x, y: edgeY }, { x: right.x, y: edgeY }, b)];
    }
    const a = { x: left.x + half, y: left.y }, b = { x: right.x - half, y: right.y };
    const bend = (b.x - a.x) / 2;
    return [curve(a, { x: a.x + bend, y: a.y }, { x: b.x - bend, y: b.y }, b)];
  });
}
