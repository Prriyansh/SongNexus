// The geometry of a connection web: where its artists go, what the camera sees, which names fit.
// Pure, and the same every time for the same web. Safe to import from client components.
import type { GraphData, GraphEdge, GraphNode } from "./types";

export type Point = { x: number; y: number };
export type View = { x: number; y: number; width: number; height: number };
export type Web = { center: string; nodes: GraphNode[]; edges: GraphEdge[]; opened: string[] };

/** A web never grows past this, so it stays readable. */
export const MAX_NODES = 70;

export const edgeKey = (e: { a: string; b: string }) =>
  e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;

export function startWeb(data: GraphData): Web {
  return { center: data.center, nodes: data.nodes, edges: data.edges, opened: [data.center] };
}

/** Adds an opened artist's connections, up to the cap. */
export function growWeb(web: Web, data: GraphData): Web {
  const known = new Set(web.nodes.map((n) => n.id));
  const room = Math.max(0, MAX_NODES - web.nodes.length);
  const nodes = [...web.nodes, ...data.nodes.filter((n) => !known.has(n.id)).slice(0, room)];
  const ids = new Set(nodes.map((n) => n.id));
  const edges = new Map(web.edges.map((e) => [edgeKey(e), e]));
  for (const e of data.edges) if (ids.has(e.a) && ids.has(e.b)) edges.set(edgeKey(e), e);
  const opened = web.opened.includes(data.center) ? web.opened : [...web.opened, data.center];
  return { ...web, nodes, edges: [...edges.values()], opened };
}

export function radiusOf(node: GraphNode, center: string): number {
  return node.id === center ? 32 : 17 + Math.min(9, Math.sqrt(node.degree) / 2.2);
}

// ---------------------------------------------------------------------------
// Layout: a small force simulation
// ---------------------------------------------------------------------------

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const STEPS = 320;
const SPACING = 92;
/** How hard artists push each other apart; higher spreads the web out. */
const REPULSION = 0.068;
/** How hard everything is drawn to the middle; weaker sideways, as screens are wide. */
const GRAVITY = { x: 0.042, y: 0.07 };
/** A link's natural length, in spacings. */
const LINK_LENGTH = 1.2;
/** The closest two artists may end up, so their pictures and names don't touch. */
const MIN_DISTANCE = 66;

/** Moves apart any two artists the simulation left too close; the one in the middle stays. */
export function separate(x: Float64Array, y: Float64Array, center: number) {
  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (let i = 0; i < x.length; i++) {
      for (let j = i + 1; j < x.length; j++) {
        const dx = x[j] - x[i] || 0.01;
        const dy = y[j] - y[i] || 0.01;
        const distance = Math.hypot(dx, dy);
        if (distance >= MIN_DISTANCE) continue;
        moved = true;
        const push = (MIN_DISTANCE - distance) / distance;
        const [mine, theirs] = i === center ? [0, 1] : j === center ? [1, 0] : [0.5, 0.5];
        x[i] -= dx * push * mine;
        y[i] -= dy * push * mine;
        x[j] += dx * push * theirs;
        y[j] += dy * push * theirs;
      }
    }
    if (!moved) return;
  }
}

/**
 * Positions for every artist, with the starting artist in the middle. Artists already placed
 * (`from`) start where they were, so opening someone doesn't shuffle the rest.
 */
export function layoutWeb(
  web: Web,
  from: ReadonlyMap<string, Point> = new Map(),
): Map<string, Point> {
  const n = web.nodes.length;
  const at = new Map(web.nodes.map((node, i) => [node.id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  // A new artist starts beside someone already placed that they are linked to.
  const anchorOf = (id: string) => {
    const link = web.edges.find(
      (e) => (e.a === id && from.has(e.b)) || (e.b === id && from.has(e.a)),
    );
    return link && from.get(link.a === id ? link.b : link.a);
  };
  web.nodes.forEach((node, i) => {
    const before = from.get(node.id);
    const anchor = before ? undefined : anchorOf(node.id);
    const radius = anchor ? SPACING * 1.4 : SPACING * Math.sqrt(i + 0.5);
    x[i] = before?.x ?? (anchor ? anchor.x * 1.25 : 0) + radius * Math.cos(i * GOLDEN_ANGLE);
    y[i] = before?.y ?? (anchor ? anchor.y * 1.25 : 0) + radius * Math.sin(i * GOLDEN_ANGLE);
  });

  const degree = new Float64Array(n);
  for (const e of web.edges) {
    degree[at.get(e.a)!]++;
    degree[at.get(e.b)!]++;
  }
  const links = web.edges.map((e) => {
    const [a, b] = [at.get(e.a)!, at.get(e.b)!];
    // Artists with many links are pulled less by each, so a busy group doesn't collapse.
    const pull = Math.min(1, 0.25 + e.strength / 20) / Math.sqrt(Math.min(degree[a], degree[b]));
    return { a, b, pull };
  });

  const center = at.get(web.center)!;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  for (let step = 0; step < STEPS; step++) {
    fx.fill(0);
    fy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = x[i] - x[j] || 0.01;
        const dy = y[i] - y[j] || 0.01;
        const push = (SPACING * SPACING * REPULSION) / Math.max(dx * dx + dy * dy, 100);
        fx[i] += dx * push;
        fy[i] += dy * push;
        fx[j] -= dx * push;
        fy[j] -= dy * push;
      }
      fx[i] -= x[i] * GRAVITY.x;
      fy[i] -= y[i] * GRAVITY.y;
    }
    for (const { a, b, pull } of links) {
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const length = Math.hypot(dx, dy) || 1;
      const force = ((length - SPACING * LINK_LENGTH) / length) * 0.09 * pull;
      fx[a] += dx * force;
      fy[a] += dy * force;
      fx[b] -= dx * force;
      fy[b] -= dy * force;
    }
    const limit = 18 * (1 - step / STEPS) + 1;
    for (let i = 0; i < n; i++) {
      const size = Math.hypot(fx[i], fy[i]) || 1;
      const move = Math.min(size, limit) / size;
      x[i] += fx[i] * move;
      y[i] += fy[i] * move;
    }
    x[center] = 0;
    y[center] = 0;
  }
  separate(x, y, center);
  const round = (value: number) => Math.round(value * 10) / 10 + 0;
  return new Map(web.nodes.map((node, i) => [node.id, { x: round(x[i]), y: round(y[i]) }]));
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const CLOSEST = 220;
const FARTHEST = 6000;

/** The part of the plane that shows every artist, with room for their names. */
export function fitView(points: Iterable<Point>, padX = 105, padY = 64): View {
  const all = [...points];
  const left = Math.min(0, ...all.map((p) => p.x)) - padX;
  const right = Math.max(0, ...all.map((p) => p.x)) + padX;
  const top = Math.min(0, ...all.map((p) => p.y)) - padY;
  const bottom = Math.max(0, ...all.map((p) => p.y)) + padY;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Zooms a view by a factor (below 1 is closer), keeping the given point where it is on screen. */
export function zoomView(view: View, factor: number, around: Point): View {
  const width = Math.min(FARTHEST, Math.max(CLOSEST, view.width * factor));
  const scale = width / view.width;
  return {
    x: around.x - (around.x - view.x) * scale,
    y: around.y - (around.y - view.y) * scale,
    width,
    height: view.height * scale,
  };
}

/** Ease in and out (cubic). */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function mixViews(a: View, b: View, t: number): View {
  return {
    x: mix(a.x, b.x, t),
    y: mix(a.y, b.y, t),
    width: mix(a.width, b.width, t),
    height: mix(a.height, b.height, t),
  };
}

/** Positions part of the way from one layout to the next. New artists come out of `origin`. */
export function mixPoints(
  a: ReadonlyMap<string, Point>,
  b: ReadonlyMap<string, Point>,
  t: number,
  origin: Point,
): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const [id, to] of b) {
    const from = a.get(id) ?? origin;
    out.set(id, { x: mix(from.x, to.x, t), y: mix(from.y, to.y, t) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Names and keyboard
// ---------------------------------------------------------------------------

/** `always` names show whatever they cover: the ones being looked at. */
export type Label = Point & {
  id: string;
  text: string;
  radius: number;
  priority: number;
  always?: boolean;
};

/** An average letter's width, in font sizes. */
const LETTER = 0.58;

/** The artists whose names fit without covering a face or another name, most important first. */
export function visibleLabels(labels: Label[], fontSize: number): Set<string> {
  const taken: { left: number; right: number; top: number; bottom: number }[] = [];
  const shown = new Set<string>();
  for (const label of [...labels].sort(
    (p, q) => Number(q.always ?? false) - Number(p.always ?? false) || q.priority - p.priority,
  )) {
    const half = (label.text.length * LETTER * fontSize) / 2;
    const top = label.y + label.radius + fontSize * 0.25;
    const box = {
      left: label.x - half,
      right: label.x + half,
      top,
      bottom: top + fontSize * 1.2,
    };
    const overName = taken.some(
      (t) => box.left < t.right && box.right > t.left && box.top < t.bottom && box.bottom > t.top,
    );
    const overFace = labels.some(
      (other) =>
        other.id !== label.id &&
        box.left < other.x + other.radius &&
        box.right > other.x - other.radius &&
        box.top < other.y + other.radius &&
        box.bottom > other.y - other.radius,
    );
    if (!label.always && (overName || overFace)) continue;
    taken.push(box);
    shown.add(label.id);
  }
  return shown;
}

export const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

/** The artist the eye would go to next in a direction: ahead, and more straight on than close. */
export function nextInDirection(
  points: ReadonlyMap<string, Point>,
  from: string,
  [dx, dy]: readonly [number, number],
): string | null {
  const start = points.get(from);
  if (!start) return null;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const [id, point] of points) {
    const [vx, vy] = [point.x - start.x, point.y - start.y];
    const along = vx * dx + vy * dy;
    const across = Math.abs(vx * dy - vy * dx);
    // Within 60 degrees of straight ahead; anything further belongs to another arrow.
    if (id === from || along <= 0 || across > along * 1.73) continue;
    const score = along + 2 * across;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}
