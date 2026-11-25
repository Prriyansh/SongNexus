import { describe, expect, it } from 'vitest';
import type { SimilarNode, SimilarWeb } from '@/lib/types';
import { discoveredNodes, discoveryEdges, layoutSimilarWeb, placeDiscovered, WEB_CARD } from '../similar-web';
import type { Discovery, WebNode } from '../similar-web';
import { buildWebDetailIndex, focusAt, webDetailOpacity } from '../similar-detail';
import type { WebCamera } from '../web-navigation';
import { worldToWebScreen } from '../web-navigation';
import { similarWeb } from './fixtures';

const STYLES = ['pop', 'rock', 'indie', 'folk', 'hip hop', 'jazz'];
const node = (i: number, kind: 'artist' | 'song' = 'artist', prefix: string = kind): SimilarNode => ({
  kind, id: `${prefix}-${i}`, name: `${prefix} ${i}`, subtitle: STYLES[i % STYLES.length], artist: kind === 'song' ? `singer ${i % 9}` : undefined,
  imageUrl: null, similarity: 1 - i / 60, rank: i, listeners: null, reasons: [],
});
const crowded = (count = 54): SimilarWeb => ({ ...similarWeb, artists: Array.from({ length: count / 2 }, (_, i) => node(i)), songs: Array.from({ length: count / 2 }, (_, i) => node(i, 'song')), links: [] });
const W = 1200, H = 600;
const onScreen = (nodes: WebNode[], camera: WebCamera, focus = null as ReturnType<typeof focusAt> | null) => {
  const index = buildWebDetailIndex(nodes, W, H);
  const opacity = webDetailOpacity(nodes, { width: W, height: H, camera, focus, index });
  return nodes.filter(n => (opacity.get(n.id) ?? 0) > .5).filter(n => { const p = worldToWebScreen(n, camera); return p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H; });
};
/** Zoom around the map's middle, as the zoom buttons do. */
const around = (zoom: number): WebCamera => ({ zoom, x: W / 2 - W / 2 * zoom, y: H / 2 - H / 2 * zoom });

describe('zoom-dependent detail (Helen\'s level of detail)', () => {
  const nodes = layoutSimilarWeb(crowded(), W, H);

  it('shows a small set zoomed out and more in view as you zoom in', () => {
    const far = onScreen(nodes, around(.62)).length, normal = onScreen(nodes, around(1)).length, close = onScreen(nodes, around(1.6)).length;
    expect(far).toBeLessThan(normal);
    expect(far).toBeLessThanOrEqual(10);
    expect(close).toBeGreaterThan(onScreen(nodes, around(1.6)).filter(n => n.isCenter).length);
    // Zoomed in, the visible area is smaller, yet it holds more than the same area did before.
    const region = (camera: WebCamera) => (n: WebNode) => { const p = worldToWebScreen(n, camera); return p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H; };
    const sameArea = onScreen(nodes, around(1)).filter(region(around(1.6))).length;
    expect(close).toBeGreaterThan(sameArea);
  });

  it('always keeps the selection', () => {
    const opacity = webDetailOpacity(nodes, { width: W, height: H, camera: around(.62) });
    expect(opacity.get(nodes[0].id)).toBe(1);
  });

  it('keeps the zoomed-out overview varied', () => {
    const shown = onScreen(nodes, around(.62)).filter(n => !n.isCenter);
    const styles = shown.map(n => `${n.kind}:${n.kind === 'song' ? n.artist : n.subtitle}`);
    expect(new Set(styles).size).toBe(styles.length);
  });

  it('never re-ranks while panning: the same members show at the same zoom', () => {
    const index = buildWebDetailIndex(nodes, W, H);
    const at = (x: number, y: number) => webDetailOpacity(nodes, { width: W, height: H, camera: { zoom: 1, x, y }, index });
    expect(at(-300, 120)).toEqual(at(0, 0));
  });

  it('keeps earlier cell members as artists are added', () => {
    const before = buildWebDetailIndex(nodes, W, H);
    const more = [...nodes, { ...node(99, 'artist', 'new'), x: nodes[3].x + 5, y: nodes[3].y + 5, isCenter: false, discoveryZoom: 1.5 }];
    const after = buildWebDetailIndex(more, W, H, before);
    for (const [key, cell] of before.cells) expect(after.cells.get(key)!.ids.slice(0, cell.ids.length)).toEqual(cell.ids);
    expect(after.overview).toEqual(before.overview);
  });

  it('shows more around the focus than elsewhere once zoomed in', () => {
    const camera = { zoom: 1.4, x: 0, y: 0 };
    const index = buildWebDetailIndex(nodes, W, H);
    const near = { x: W * .15, y: H * .2, nodeId: null };
    const far = { x: W * .85, y: H * .8, nodeId: null };
    const inCorner = (opacity: Map<string, number>) => nodes.filter(n => n.x < W / 3 && n.y < H / 2 && (opacity.get(n.id) ?? 0) > .5).length;
    expect(inCorner(webDetailOpacity(nodes, { width: W, height: H, camera, focus: near, index })))
      .toBeGreaterThanOrEqual(inCorner(webDetailOpacity(nodes, { width: W, height: H, camera, focus: far, index })));
  });
});

describe('focus', () => {
  it('is the world point under the pointer and the nearest artist, never the center or a song', () => {
    const nodes = layoutSimilarWeb(crowded(), W, H);
    const artist = nodes.find(n => n.kind === 'artist' && !n.isCenter)!;
    const camera = { zoom: 1.5, x: -100, y: 40 };
    const focus = focusAt(nodes, worldToWebScreen(artist, camera), camera);
    expect(focus.nodeId).toBe(artist.id);
    expect(focus.x).toBeCloseTo(artist.x);
    expect(focusAt(nodes, worldToWebScreen(nodes[0], camera), camera).nodeId).not.toBe(nodes[0].id);
    expect(focusAt([nodes[0]], { x: 0, y: 0 }, camera).nodeId).toBeNull();
  });
});

describe('artists found by zooming in', () => {
  const base = layoutSimilarWeb(similarWeb, W, H);
  const taylor = similarWeb.artists[0];
  const found = (count: number, offset = 0): SimilarWeb => ({ ...similarWeb, center: taylor, artists: [...Array.from({ length: count }, (_, i) => node(i + offset, 'artist', 'found')), similarWeb.artists[1]], songs: [], links: [] });
  const discovery = (similar: SimilarWeb, zoom = 1.5): Discovery => ({ via: { id: taylor.id, name: taylor.name }, zoom, similar });

  it('adds the closest ten new artists, skipping anyone already on the map', () => {
    const added = discoveredNodes(similarWeb, [discovery(found(14))]);
    expect(added).toHaveLength(10);
    expect(added.map(n => n.id)).not.toContain(similarWeb.artists[1].id);
    expect(added[0]).toMatchObject({ via: { id: taylor.id, name: 'Taylor Swift' }, discoveryZoom: 1.5 });
    expect(discoveredNodes(similarWeb, [discovery(found(3)), discovery(found(3))])).toHaveLength(3);
  });

  it('places them around their artist without moving anything, at the scale they were found', () => {
    const added = discoveredNodes(similarWeb, [discovery(found(10))]);
    const placed = placeDiscovered(base, added);
    expect(placed.slice(0, base.length)).toEqual(base);
    const parent = base.find(n => n.id === taylor.id)!;
    const scale = 1 / 1.5;
    const fresh = placed.slice(base.length);
    for (const n of fresh) expect(Math.hypot(n.x - parent.x, n.y - parent.y)).toBeLessThan(260 * scale + 60);
    for (let i = 0; i < placed.length; i++) for (const other of placed.slice(i + 1)) {
      if (!fresh.includes(other)) continue;
      const box = placed[i].isCenter ? { width: 150, height: 128 } : WEB_CARD;
      expect(((placed[i].x - other.x) / (box.width * scale)) ** 2 + ((placed[i].y - other.y) / (box.height * scale)) ** 2).toBeGreaterThanOrEqual(.999);
    }
    expect(placeDiscovered(base, added)).toEqual(placed);
  });

  it('links each to the artist it came from, plus listening links on the map', () => {
    const similar = { ...found(2), links: [{ from: 'found-0', to: 'found-1', kind: 'listeners' as const }, { from: 'found-0', to: 'elsewhere', kind: 'listeners' as const }] };
    const added = discoveredNodes(similarWeb, [discovery(similar)]);
    const edges = discoveryEdges(added, [discovery(similar)], new Set([...base.map(n => n.id), ...added.map(n => n.id)]));
    expect(edges).toEqual([
      { from: taylor.id, to: 'found-0', kind: 'similarity', strength: added[0].similarity },
      { from: taylor.id, to: 'found-1', kind: 'similarity', strength: added[1].similarity },
      { from: 'found-0', to: 'found-1', kind: 'neighbour', strength: 1 },
    ]);
  });

  it('stay hidden until the camera is close again', () => {
    const placed = placeDiscovered(base, discoveredNodes(similarWeb, [discovery(found(4), 1.6)]));
    const index = buildWebDetailIndex(placed, W, H);
    const id = placed[placed.length - 1].id;
    expect(webDetailOpacity(placed, { width: W, height: H, camera: around(1), index }).get(id)).toBe(0);
    expect(webDetailOpacity(placed, { width: W, height: H, camera: around(2.2), index }).get(id)).toBeGreaterThan(.5);
  });
});
