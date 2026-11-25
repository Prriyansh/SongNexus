// Turns the similar-music response into a map: the selection in the center, everything else at a
// distance set by how similar it is. Lines mean "similar" or "performs this song", never a credit.
import type { SimilarLink, SimilarNode, SimilarWeb } from '@/lib/types';

export const WEB_CARD = { width: 96, height: 88 };
const CENTER_CLEARANCE = { width: 150, height: 128 };

/** Artists found by zooming in also say which artist they're similar to, and at what zoom they were found. */
export type DiscoveredNode = SimilarNode & { via: { id: string; name: string }; discoveryZoom: number };
export type WebNode = SimilarNode & { x: number; y: number; isCenter: boolean; group?: string; via?: DiscoveredNode['via']; discoveryZoom?: number };
export type WebEdge = { from: string; to: string; kind: 'similarity' | 'performed' | 'neighbour' | 'contains' | 'similar' | 'recommended'; strength: number };
export type WebFilter = 'all' | 'artist' | 'song';

const seedOf = (id: string) => {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
};

/** 0 at the center's edge, 1 at the far end of the map: the less similar, the further out. */
export const distanceFactor = (similarity: number) => .3 + (1 - Math.max(0, Math.min(1, similarity))) * .7;

/**
 * Deterministic: the same music always lands in the same place. Closest matches are placed first,
 * and something pushed aside by a neighbour only ever moves outward, so distance keeps its meaning.
 */
export function layoutSimilarWeb(web: SimilarWeb, width: number, height: number): WebNode[] {
  const center = { x: width / 2, y: height / 2 };
  const placed: WebNode[] = [{ ...web.center, ...center, isCenter: true }];
  const others = [...web.artists, ...web.songs].sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
  const rx = Math.max(260, width * .46), ry = Math.max(190, height * .46);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const clear = (x: number, y: number) => placed.every(p => {
    const box = p.isCenter ? CENTER_CLEARANCE : WEB_CARD;
    return ((p.x - x) / box.width) ** 2 + ((p.y - y) / box.height) ** 2 >= 1;
  });
  for (const node of others) {
    const seed = seedOf(node.id);
    const base = distanceFactor(node.similarity);
    let spot = { x: center.x + rx * 3, y: center.y };
    search: for (let ring = 0; ring < 40; ring++) {
      const factor = base + ring * .05;
      for (let turn = 0; turn < 24; turn++) {
        const angle = seed * Math.PI * 2 + turn * goldenAngle;
        const x = center.x + Math.cos(angle) * rx * factor, y = center.y + Math.sin(angle) * ry * factor;
        if (clear(x, y)) { spot = { x, y }; break search; }
      }
    }
    placed.push({ ...node, ...spot, isCenter: false });
  }
  return placed;
}

export function buildWebEdges(web: SimilarWeb): WebEdge[] {
  const toCenter = [...web.artists, ...web.songs].map((node): WebEdge => ({ from: web.center.id, to: node.id, kind: 'similarity', strength: node.similarity }));
  const seen = new Set(toCenter.map(e => [e.from, e.to].sort().join('|')));
  const extra = web.links.flatMap((link: SimilarLink): WebEdge[] => {
    const key = [link.from, link.to].sort().join('|');
    if (link.kind === 'listeners') {
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ from: link.from, to: link.to, kind: 'neighbour', strength: 1 }];
    }
    return [{ from: link.from, to: link.to, kind: 'performed', strength: 1 }];
  });
  return [...toCenter, ...extra];
}

/** Everyone else on the map this one is directly connected to, for the explanation card. */
export function connectionsOf(id: string, web: SimilarWeb): string[] {
  const names = new Map([web.center, ...web.artists, ...web.songs].map(n => [n.id, n.name]));
  return [...new Set(web.links.flatMap(l => l.from === id ? [l.to] : l.to === id ? [l.from] : []))].flatMap(other => names.get(other) ?? []);
}

/** Zooming in near an artist loads what's similar to it (docs/connection-web-progressive-discovery.md). */
export type Discovery = { via: { id: string; name: string }; zoom: number; similar: SimilarWeb };
const PER_DISCOVERY = 10;

/** The closest new artists from each discovery, in order; anything already on the map stays where it is. */
export function discoveredNodes(web: SimilarWeb, discoveries: Discovery[]): DiscoveredNode[] {
  const seen = new Set([web.center, ...web.artists, ...web.songs].map(n => n.id));
  return discoveries.flatMap(({ via, zoom, similar }) => {
    const fresh = [...similar.artists].sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
      .filter(n => !seen.has(n.id)).slice(0, PER_DISCOVERY);
    for (const n of fresh) seen.add(n.id);
    return fresh.map(n => ({ ...n, via, discoveryZoom: zoom }));
  });
}

/**
 * Around the artist each was found from, at that zoom's scale: cards keep their pixel size, so in
 * world space they need less room the closer the camera is. Placed in order and never moved.
 */
export function placeDiscovered(base: WebNode[], found: DiscoveredNode[]): WebNode[] {
  const placed = [...base];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (const node of found) {
    const parent = placed.find(p => p.id === node.via.id);
    if (!parent) continue;
    const scale = 1 / node.discoveryZoom;
    const clear = (x: number, y: number) => placed.every(p => {
      const box = p.isCenter ? CENTER_CLEARANCE : WEB_CARD;
      return ((p.x - x) / (box.width * scale)) ** 2 + ((p.y - y) / (box.height * scale)) ** 2 >= 1;
    });
    const seed = seedOf(node.id);
    const reach = (WEB_CARD.width + (1 - Math.max(0, Math.min(1, node.similarity))) * 90) * scale;
    let spot = { x: parent.x + reach * 4, y: parent.y };
    search: for (let ring = 0; ring < 40; ring++) {
      for (let turn = 0; turn < 24; turn++) {
        const angle = seed * Math.PI * 2 + turn * goldenAngle, r = reach + ring * 12 * scale;
        const x = parent.x + Math.cos(angle) * r, y = parent.y + Math.sin(angle) * r * .8;
        if (clear(x, y)) { spot = { x, y }; break search; }
      }
    }
    placed.push({ ...node, ...spot, isCenter: false });
  }
  return placed;
}

/** A similarity line to the artist each was found from, and listening links between artists on the map. */
export function discoveryEdges(found: DiscoveredNode[], discoveries: Discovery[], onMap: Set<string>): WebEdge[] {
  const fromVia = found.map((n): WebEdge => ({ from: n.via.id, to: n.id, kind: 'similarity', strength: n.similarity }));
  const seen = new Set(fromVia.map(e => [e.from, e.to].sort().join('|')));
  const added = new Set(found.map(n => n.id));
  const neighbours = discoveries.flatMap(d => d.similar.links).flatMap((link): WebEdge[] => {
    const key = [link.from, link.to].sort().join('|');
    if (link.kind !== 'listeners' || seen.has(key) || !onMap.has(link.from) || !onMap.has(link.to) || !(added.has(link.from) || added.has(link.to))) return [];
    seen.add(key);
    return [{ from: link.from, to: link.to, kind: 'neighbour', strength: 1 }];
  });
  return [...fromVia, ...neighbours];
}

/** The closest few always show; the rest fade in once there's room for their labels. */
export function nodeOpacity(node: WebNode, zoom: number): number {
  if (node.isCenter || node.rank < ALWAYS_SHOWN) return 1;
  return Math.max(0, Math.min(1, (zoom - .72) / .2));
}
const ALWAYS_SHOWN = 8;

export const closenessLabel = (similarity: number) => `${Math.round(similarity * 100)}% of the closest match`;
