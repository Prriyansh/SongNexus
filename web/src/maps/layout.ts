/**
 * Where things go on a similar-music map, and the map's camera. Ported from the team app's
 * Connection Web (Helen's map and camera, Lakadia's similar-music and playlist layouts).
 *
 * Similarity maps put the selection in the middle and everything else at a distance set by how
 * similar it is: the closest match sits nearest, and something pushed aside by a neighbour only
 * ever moves outward, so distance keeps its meaning. Playlist maps run left (you) to right (your
 * friend), with what you share in the middle. Pure and deterministic: the same map always lands
 * the same way.
 */
import type {Schemas} from '../api/client';

export type MapNode = Schemas['MapNode'];
export type MapLink = Schemas['MapLink'];
export type MapGroup = Schemas['MapGroup'];

export interface Placed extends MapNode {
  x: number;
  y: number;
  isCenter: boolean;
  /** 0 = the closest match; the closest few always show. */
  rank: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const CARD = {width: 104, height: 92};
const CENTER_CLEARANCE = {width: 160, height: 136};
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 4;
/** The closest few always show; the rest fade in as the map gets room for their labels. */
export const ALWAYS_SHOWN = 8;

/** A stable 0–1 number per ID, so the same map always lands the same way. */
export function seedOf(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}

/** 0.3 at the center's edge, 1 at the far end: the less similar, the further out. */
export const distanceFactor = (similarity: number) =>
  0.3 + (1 - Math.max(0, Math.min(1, similarity))) * 0.7;

function isClear(
  placed: readonly Placed[],
  x: number,
  y: number,
  scale = 1,
): boolean {
  return placed.every(p => {
    const box = p.isCenter ? CENTER_CLEARANCE : CARD;
    return (
      ((p.x - x) / (box.width * scale)) ** 2 +
        ((p.y - y) / (box.height * scale)) ** 2 >=
      1
    );
  });
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** The selection in the middle; closest matches placed first, nearest. */
export function layoutSimilar(
  center: MapNode,
  nodes: readonly MapNode[],
  width: number,
  height: number,
): Placed[] {
  const middle = {x: width / 2, y: height / 2};
  const placed: Placed[] = [{...center, ...middle, isCenter: true, rank: -1}];
  const others = [...nodes].sort(
    (a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id),
  );
  const rx = Math.max(260, width * 0.46);
  const ry = Math.max(190, height * 0.46);
  others.forEach((node, rank) => {
    const seed = seedOf(node.id);
    const base = distanceFactor(node.similarity);
    let spot = {x: middle.x + rx * 3, y: middle.y};
    search: for (let ring = 0; ring < 40; ring++) {
      const factor = base + ring * 0.05;
      for (let turn = 0; turn < 24; turn++) {
        const angle = seed * Math.PI * 2 + turn * GOLDEN_ANGLE;
        const x = middle.x + Math.cos(angle) * rx * factor;
        const y = middle.y + Math.sin(angle) * ry * factor;
        if (isClear(placed, x, y)) {
          spot = {x, y};
          break search;
        }
      }
    }
    placed.push({...node, ...spot, isCenter: false, rank});
  });
  return placed;
}

/** Bands across the width, as shares: you on the left, your friend on the right. */
const BANDS: Record<MapGroup, [number, number]> = {
  MINE: [0.03, 0.24],
  FOR_THEM: [0.24, 0.36],
  SHARED: [0.42, 0.58],
  NEW: [0.36, 0.64],
  FOR_ME: [0.64, 0.76],
  THEIRS: [0.76, 0.97],
  CENTER: [0.45, 0.55],
  SIMILAR: [0.36, 0.64],
};
const SOLO_BANDS: Partial<Record<MapGroup, [number, number]>> = {
  MINE: [0.03, 0.55],
  NEW: [0.6, 0.97],
};
export const TASTE_WORLD_WIDTH = 1200;

/** A playlist map: artists first, the most-played first; taller than the view when it must be. */
export function layoutTaste(
  nodes: readonly MapNode[],
  width: number,
  height: number,
  hasFriend: boolean,
): Placed[] {
  const world = Math.max(width, hasFriend ? TASTE_WORLD_WIDTH : 900);
  const bands = hasFriend ? BANDS : {...BANDS, ...SOLO_BANDS};
  const placed: Placed[] = [];
  const ordered = [...nodes].sort(
    (a, b) =>
      Number(a.kind === 'SONG') - Number(b.kind === 'SONG') ||
      b.weight - a.weight ||
      a.id.localeCompare(b.id),
  );
  ordered.forEach((node, rank) => {
    const [from, to] = bands[node.group];
    const seed = seedOf(node.id);
    let spot = {x: (from + (to - from) * seed) * world, y: height / 2};
    search: for (let row = 0; row < 40; row++) {
      for (const side of [1, -1]) {
        const y = height / 2 + side * row * CARD.height * 0.9;
        for (let step = 0; step < 12; step++) {
          const x =
            (from + (to - from) * ((seed + step * 0.381966) % 1)) * world;
          if (isClear(placed, x, y)) {
            spot = {x, y};
            break search;
          }
        }
      }
    }
    placed.push({...node, ...spot, isCenter: false, rank});
  });
  return placed;
}

/** Lines from the center to everything (as strong as it is similar), plus the map's links. */
export function similarLines(
  center: MapNode,
  nodes: readonly MapNode[],
  links: readonly MapLink[],
): MapLink[] {
  const spokes = nodes.map((n): MapLink => ({
    a: center.id,
    b: n.id,
    kind: 'SIMILAR',
    strength: n.similarity,
  }));
  const seen = new Set(spokes.map(l => [l.a, l.b].sort().join('|')));
  return [
    ...spokes,
    ...links.filter(l => {
      const key = [l.a, l.b].sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

/** Names directly linked to a node (besides the center), for its explanation card. */
export function linkedNames(
  id: string,
  nodes: readonly MapNode[],
  links: readonly MapLink[],
  centerId?: string,
): string[] {
  const names = new Map(nodes.map(n => [n.id, n.displayName]));
  const others = links.flatMap(l =>
    l.a === id ? [l.b] : l.b === id ? [l.a] : [],
  );
  return [...new Set(others)]
    .filter(o => o !== centerId)
    .flatMap(o => names.get(o) ?? []);
}

/** How visible a node is at a zoom: the closest always, the rest once there's room. */
export function nodeOpacity(node: Placed, zoom: number): number {
  if (node.isCenter || node.rank < ALWAYS_SHOWN) return 1;
  return Math.max(0, Math.min(1, (zoom - 0.72) / 0.2));
}

export const initialCamera = (): Camera => ({x: 0, y: 0, zoom: 1});

/** Keeps the world point under the pointer fixed as the zoom changes. */
export function zoomCamera(
  camera: Camera,
  zoom: number,
  focal: {x: number; y: number},
): Camera {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const ratio = next / camera.zoom;
  return {
    zoom: next,
    x: focal.x - (focal.x - camera.x) * ratio,
    y: focal.y - (focal.y - camera.y) * ratio,
  };
}

export const toScreen = (point: {x: number; y: number}, camera: Camera) => ({
  x: point.x * camera.zoom + camera.x,
  y: point.y * camera.zoom + camera.y,
});

/** Starts a wide playlist map on its middle, where the two playlists meet. */
export const centeredOn = (width: number, world: number): Camera => ({
  x: Math.min(0, (width - world) / 2),
  y: 0,
  zoom: 1,
});

/** Artists found by zooming in near another: which one, and how close the camera was. */
export interface Discovery {
  via: Placed;
  zoom: number;
  nodes: readonly MapNode[];
}
const PER_DISCOVERY = 10;

/**
 * Places each discovery's closest new artists around the artist it came from, at that zoom's
 * scale (cards keep their pixel size, so closer in they need less world space). In order, and
 * never moving anything already placed.
 */
export function placeDiscovered(
  base: readonly Placed[],
  discoveries: readonly Discovery[],
): {placed: Placed[]; lines: MapLink[]} {
  const placed = [...base];
  const seen = new Set(placed.map(p => p.id));
  const lines: MapLink[] = [];
  for (const {via, zoom, nodes} of discoveries) {
    const parent = placed.find(p => p.id === via.id);
    if (!parent) continue;
    const scale = 1 / Math.max(1, zoom);
    const fresh = [...nodes]
      .filter(n => n.kind === 'ARTIST' && !seen.has(n.id))
      .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
      .slice(0, PER_DISCOVERY);
    for (const node of fresh) {
      seen.add(node.id);
      const seed = seedOf(node.id);
      const reach = (CARD.width + (1 - node.similarity) * 90) * scale;
      let spot = {x: parent.x + reach * 4, y: parent.y};
      search: for (let ring = 0; ring < 40; ring++) {
        for (let turn = 0; turn < 24; turn++) {
          const angle = seed * Math.PI * 2 + turn * GOLDEN_ANGLE;
          const r = reach + ring * 12 * scale;
          const x = parent.x + Math.cos(angle) * r;
          const y = parent.y + Math.sin(angle) * r * 0.8;
          if (isClear(placed, x, y, scale)) {
            spot = {x, y};
            break search;
          }
        }
      }
      // Fades in with the outer ring: found up close, it needs the room zooming in gives.
      placed.push({...node, ...spot, isCenter: false, rank: ALWAYS_SHOWN});
      lines.push({
        a: parent.id,
        b: node.id,
        kind: 'SIMILAR',
        strength: node.similarity,
      });
    }
  }
  return {placed, lines};
}

/**
 * Two artists on one map (Helen's comparison web): the pair at either end, the credit path
 * along the middle, who listeners play with both between them, and each one's own neighbours
 * around them, closer the more similar. Ranked closest first, so zooming in reveals more.
 */
export function layoutCompare(
  nodes: readonly MapNode[],
  path: readonly string[],
  width: number,
  height: number,
): Placed[] {
  const world = Math.max(width, 1000);
  const y0 = height / 2;
  const left = {x: world * 0.16, y: y0};
  const right = {x: world * 0.84, y: y0};
  const [a, b, ...rest] = nodes;
  if (!a || !b) return [];
  const placed: Placed[] = [
    {...a, ...left, isCenter: true, rank: -1},
    {...b, ...right, isCenter: true, rank: -1},
  ];
  const steps = path.slice(1, -1);
  steps.forEach((id, i) => {
    const node = rest.find(n => n.id === id);
    if (!node) return;
    const t = (i + 1) / (steps.length + 1);
    placed.push({
      ...node,
      x: left.x + (right.x - left.x) * t,
      y: y0 + (i % 2 ? 36 : -36),
      isCenter: false,
      rank: -1,
    });
  });
  const others = rest
    .filter(n => !steps.includes(n.id))
    .sort((x, y) => y.similarity - x.similarity || x.id.localeCompare(y.id));
  const rx = Math.max(220, world * 0.3);
  const ry = Math.max(180, height * 0.44);
  others.forEach((node, rank) => {
    const seed = seedOf(node.id);
    const base = distanceFactor(node.similarity);
    const origin =
      node.group === 'MINE'
        ? left
        : node.group === 'THEIRS'
          ? right
          : {x: world / 2, y: y0};
    // Each side fans out away from the middle; shared artists sit above and below the path.
    const sector =
      node.group === 'MINE'
        ? [Math.PI * 0.5, Math.PI * 1.5]
        : node.group === 'THEIRS'
          ? [-Math.PI * 0.5, Math.PI * 0.5]
          : [0, Math.PI * 2];
    let spot = {x: origin.x, y: origin.y + ry * 2};
    search: for (let ring = 0; ring < 40; ring++) {
      const factor =
        (node.group === 'SHARED' ? 0.35 + base * 0.4 : base) + ring * 0.05;
      for (let turn = 0; turn < 24; turn++) {
        const along = (seed + turn * 0.381966) % 1;
        const angle = sector[0]! + (sector[1]! - sector[0]!) * along;
        const x = origin.x + Math.cos(angle) * rx * factor;
        const y = origin.y + Math.sin(angle) * ry * factor;
        if (isClear(placed, x, y)) {
          spot = {x, y};
          break search;
        }
      }
    }
    placed.push({...node, ...spot, isCenter: false, rank});
  });
  return placed;
}

export const COMPARE_WORLD_WIDTH = 1000;
