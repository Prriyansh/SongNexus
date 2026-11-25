// Places the artists of a connection web: a small force layout, the same every time for the same web.
import type { GraphData, GraphEdge, GraphNode } from "./types";

export type Point = { x: number; y: number };
export type Web = { center: string; nodes: GraphNode[]; edges: GraphEdge[]; opened: string[] };

/** A web never grows past this, so it stays readable. */
export const MAX_NODES = 70;

const edgeKey = (e: { a: string; b: string }) => (e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`);

export const startWeb = (data: GraphData): Web => ({ center: data.center, nodes: data.nodes, edges: data.edges, opened: [data.center] });

/** Adds an opened artist's connections, up to the cap. */
export function growWeb(web: Web, data: GraphData): Web {
  const known = new Set(web.nodes.map((n) => n.id));
  const added = data.nodes.filter((n) => !known.has(n.id)).slice(0, Math.max(0, MAX_NODES - web.nodes.length));
  const nodes = [...web.nodes, ...added];
  const ids = new Set(nodes.map((n) => n.id));
  const edges = new Map(web.edges.map((e) => [edgeKey(e), e]));
  for (const e of data.edges) if (ids.has(e.a) && ids.has(e.b)) edges.set(edgeKey(e), e);
  return { ...web, nodes, edges: [...edges.values()], opened: web.opened.includes(data.center) ? web.opened : [...web.opened, data.center] };
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const STEPS = 320;
const SPACING = 90;
/** How hard artists push each other apart; higher spreads the web out. */
const REPULSION = 0.065;
/** How hard everything is drawn to the middle; weaker sideways, as screens are wide. */
const GRAVITY = { x: 0.042, y: 0.07 };
/** A link's natural length, in spacings. */
const LINK_LENGTH = 1.2;

/**
 * Positions for every artist, with the starting artist in the middle. Artists already placed
 * (`from`) start where they were, so opening someone doesn't shuffle the rest.
 */
export function layoutWeb(web: Web, from: ReadonlyMap<string, Point> = new Map()): Map<string, Point> {
  const n = web.nodes.length;
  const at = new Map(web.nodes.map((node, i) => [node.id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const linkedTo = (id: string) => web.edges.find((e) => (e.a === id && from.has(e.b)) || (e.b === id && from.has(e.a)));
  web.nodes.forEach((node, i) => {
    const before = from.get(node.id);
    const link = before ? undefined : linkedTo(node.id);
    const anchor = link ? from.get(link.a === node.id ? link.b : link.a)! : { x: 0, y: 0 };
    const radius = link ? SPACING * 1.4 : SPACING * Math.sqrt(i + 0.5);
    x[i] = before?.x ?? anchor.x * (link ? 1.25 : 1) + radius * Math.cos(i * GOLDEN_ANGLE);
    y[i] = before?.y ?? anchor.y * (link ? 1.25 : 1) + radius * Math.sin(i * GOLDEN_ANGLE);
  });
  const degree = new Float64Array(n);
  for (const e of web.edges) { degree[at.get(e.a)!]++; degree[at.get(e.b)!]++; }
  const links = web.edges.map((e) => {
    const [a, b] = [at.get(e.a)!, at.get(e.b)!];
    // Artists with many links are pulled less by each, so a busy group doesn't collapse.
    return { a, b, pull: Math.min(1, 0.25 + e.strength / 20) / Math.sqrt(Math.min(degree[a], degree[b])) };
  });
  const center = at.get(web.center)!;
  for (let step = 0; step < STEPS; step++) {
    const cooling = 1 - step / STEPS;
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = x[i] - x[j] || 0.01;
        const dy = y[i] - y[j] || 0.01;
        const push = (SPACING * SPACING * REPULSION) / Math.max(dx * dx + dy * dy, 100);
        fx[i] += dx * push; fy[i] += dy * push;
        fx[j] -= dx * push; fy[j] -= dy * push;
      }
      fx[i] -= x[i] * GRAVITY.x; fy[i] -= y[i] * GRAVITY.y;
    }
    for (const { a, b, pull } of links) {
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const length = Math.hypot(dx, dy) || 1;
      const force = ((length - SPACING * LINK_LENGTH) / length) * 0.09 * pull;
      fx[a] += dx * force; fy[a] += dy * force;
      fx[b] -= dx * force; fy[b] -= dy * force;
    }
    const limit = 18 * cooling + 1;
    for (let i = 0; i < n; i++) {
      const size = Math.hypot(fx[i], fy[i]) || 1;
      const move = Math.min(size, limit) / size;
      x[i] += fx[i] * move;
      y[i] += fy[i] * move;
    }
    x[center] = 0;
    y[center] = 0;
  }
  return new Map(web.nodes.map((node, i) => [node.id, { x: Math.round(x[i] * 10) / 10, y: Math.round(y[i] * 10) / 10 }]));
}

export type View = { x: number; y: number; width: number; height: number };

/** The part of the plane that shows every artist, with room for their names. */
export function fitView(points: Iterable<Point>, pad = 90): View {
  const all = [...points];
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [left, right] = [Math.min(0, ...xs) - pad, Math.max(0, ...xs) + pad];
  const [top, bottom] = [Math.min(0, ...ys) - pad, Math.max(0, ...ys) + pad];
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Zooms a view by a factor (below 1 is closer), keeping the given point where it is on screen. */
export function zoomView(view: View, factor: number, around: Point): View {
  const width = Math.min(6000, Math.max(220, view.width * factor));
  const scale = width / view.width;
  return {
    x: around.x - (around.x - view.x) * scale,
    y: around.y - (around.y - view.y) * scale,
    width,
    height: view.height * scale,
  };
}
