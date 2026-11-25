import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../graph-layout';
import { buildWebDetailIndex, isWebArtistInViewport, presentWebDetail, selectWebDetail } from '../web-detail';
import { initialWebCamera, zoomWebCamera } from '../web-navigation';
import { buildConnectionWeb, positionWebInViewport } from '../connection-web';
import { oliviaDetails, vampireDetails } from './fixtures';

const genres = ['folk', 'j-pop', 'jazz', 'rock', 'soul', 'electronic'];
const anchor: GraphNode = { id: 'anchor', entityType: 'artist', label: 'Selected artist', subtitle: 'Folk', discoveryGenre: 'folk', role: 'anchor', x: 600, y: 320 };
const points: GraphNode[] = [anchor, ...Array.from({ length: 48 }, (_, i) => ({
  id: `peer-${String(i).padStart(2, '0')}`, entityType: 'artist' as const, label: `Peer ${i}`, subtitle: genres[i % 6], discoveryGenre: genres[i % 6],
  x: 75 + (i % 8) * 145 + Math.sin(i) * 12, y: 90 + Math.floor(i / 8) * 86 + Math.cos(i) * 8,
}))];
const view = (zoom: number, x = 0, y = 0) => ({ width: 1200, height: 620, camera: { zoom, x, y } });

describe('viewport artist detail', () => {
  it.each([.62, 1.8])('retains interior artists through repeated small and reverse pans at zoom %s', zoom => {
    const steps = [...Array.from({ length: 100 }, (_, i) => i * 2), ...Array.from({ length: 100 }, (_, i) => (99 - i) * 2)];
    let previousCamera = view(zoom).camera;
    let previous = selectWebDetail(points, [], { ...view(zoom), camera: previousCamera });
    const visible = (n: GraphNode, x: number) => isWebArtistInViewport(n, view(zoom, x));
    for (const x of steps) {
      const next = selectWebDetail(points, [], view(zoom, x));
      for (const node of previous.filter(n => visible(n, previousCamera.x) && visible(n, x))) expect(next.map(n => n.id)).toContain(node.id);
      previous = next; previousCamera = view(zoom, x).camera;
    }
  });

  it('shows a varied overview, then more points in the same region at higher zoom', () => {
    const wide = selectWebDetail(points, [], view(.62));
    const close = selectWebDetail(points, [], view(1.8));
    expect(wide.length).toBeLessThanOrEqual(7);
    expect(new Set(wide.map(n => n.discoveryGenre)).size).toBeGreaterThanOrEqual(3);
    expect(close.length).toBeGreaterThan(wide.length * 2);
    expect(close.length).toBeLessThan(points.length);
    for (const node of wide.filter(n => isWebArtistInViewport(n, view(1.8)))) expect(close).toContain(node);
    expect(selectWebDetail(points, [], view(.62))).toEqual(wide);
  });

  it('adds detail closest to the focus, without showing offscreen cached peers', () => {
    const overview = new Set(selectWebDetail(points, [], view(.62)).map(n => n.id));
    const left = selectWebDetail(points, [], { ...view(1.35), focus: { artistId: 'anchor', x: 150, y: 280 } });
    const right = selectWebDetail(points, [], { ...view(1.35), focus: { artistId: 'anchor', x: 1050, y: 280 } });
    const leftRegion = (nodes: GraphNode[]) => nodes.filter(n => !overview.has(n.id) && n.x < 400).length;
    const rightRegion = (nodes: GraphNode[]) => nodes.filter(n => !overview.has(n.id) && n.x > 800).length;
    expect(leftRegion(left)).toBeGreaterThan(leftRegion(right));
    expect(rightRegion(right)).toBeGreaterThan(rightRegion(left));
    const outside = { ...anchor, role: undefined, id: 'offscreen', x: 3000 };
    expect(selectWebDetail([...points, outside], [], view(4)).some(n => n.id === outside.id)).toBe(false);
    // Documented path nodes are retained even when panned beyond the current region.
    expect(selectWebDetail([...points, outside], [outside.id], view(.62))).toContain(outside);
  });

  it('samples the new region when panning and does not mutate cached coordinates', () => {
    const secondRegion = points.filter(n => !n.role).map(n => ({ ...n, id: `east-${n.id}`, x: n.x + 1200 }));
    const pool = [...points, ...secondRegion];
    const snapshot = JSON.stringify(pool);
    const result = selectWebDetail(pool, [], view(1.8, -1200 * 1.8));
    expect(result.filter(n => !n.role && isWebArtistInViewport(n, view(1.8, -1200 * 1.8))).every(n => n.id.startsWith('east-'))).toBe(true);
    expect(JSON.stringify(pool)).toBe(snapshot);
  });

  it.each([[457, 378], [390, 500], [1200, 560]])('shows more in-view detail with real scattered placement at %i × %i', (width, height) => {
    const journey = genres;
    const discovered = Array.from({ length: 36 }, (_, i) => ({ ...oliviaDetails, id: `nearby-${i}`, name: `Artist ${i}`, neighborhood: genres[i % 6] }));
    const graph = buildConnectionWeb({ mode: 'search', song: vampireDetails, lead: oliviaDetails }, discovered, journey);
    const nodes = positionWebInViewport(graph, width, height);
    const focal = { x: width / 2, y: height / 2 };
    const region = { width, height, camera: zoomWebCamera(initialWebCamera(), .62, focal) };
    const wide = selectWebDetail(nodes, [], region).filter(n => isWebArtistInViewport(n, region));
    const fineArtists = Array.from({ length: 24 }, (_, i) => ({ ...oliviaDetails, id: `fine-${i}`, name: `Fine artist ${i}`, neighborhood: 'pop', discoveryZoom: 2, focus: focal }));
    const fineGraph = buildConnectionWeb({ mode: 'search', song: vampireDetails, lead: oliviaDetails }, [...discovered, ...fineArtists], journey);
    const fineNodes = positionWebInViewport(fineGraph, width, height, nodes);
    const index = buildWebDetailIndex(fineNodes, [], width, height, buildWebDetailIndex(nodes, [], width, height));
    const closeRegion = { ...region, camera: zoomWebCamera(initialWebCamera(), 2, focal), index };
    const close = selectWebDetail(fineNodes, [], closeRegion).filter(n => isWebArtistInViewport(n, closeRegion));
    expect(close.length).toBeGreaterThan(wide.length);
    for (const n of close.filter(n => !n.role)) {
      expect(isWebArtistInViewport(n, closeRegion)).toBe(true);
    }
  });

  it('appends late candidates without replacing earlier representatives or changing their tiers', () => {
    const initial = points.slice(0, 5);
    const index = buildWebDetailIndex(initial, [], 1200, 620);
    const old = selectWebDetail(initial, [], { ...view(.62), index });
    const newcomer = { ...points[1], id: '000-new', discoveryGenre: 'classical', x: points[1].x + 1 };
    const pool = [...initial, newcomer];
    const next = buildWebDetailIndex(pool, [], 1200, 620, index);
    for (const [key, cell] of index.cells) expect(next.cells.get(key)?.ids.slice(0, cell.ids.length)).toEqual(cell.ids);
    expect(selectWebDetail(pool, [], { ...view(.62), index: next })).toEqual(old);
    expect(selectWebDetail(pool, [], { ...view(4), index: next })).toContain(newcomer);
  });

  it('mounts incoming points before the visible edge and removes them only beyond the buffer', () => {
    const incoming = { ...points[1], id: 'incoming', x: -80, y: 240 };
    const pool = [anchor, incoming];
    expect(isWebArtistInViewport(incoming, view(.62))).toBe(false);
    expect(selectWebDetail(pool, [], view(.62))).toContain(incoming);
    expect(selectWebDetail(pool, [], view(.62, 90))).toContain(incoming);
    expect(isWebArtistInViewport(incoming, view(.62, 90))).toBe(true);
    expect(selectWebDetail(pool, [], view(.62, -400))).not.toContain(incoming);
    expect(selectWebDetail(pool, [], view(.62, 90))).toContain(incoming);
  });

  it('fades child detail continuously and retains zero-opacity points for an exit transition', () => {
    const index = buildWebDetailIndex(points, [], 1200, 620);
    const representatives = new Set(index.overview.values());
    const child = [...index.cells.values()].map(c => c.ids[0]).find(id => !representatives.has(id))!;
    const alpha = (zoom: number) => presentWebDetail(points, [], { ...view(zoom), index }).find(p => p.node.id === child)!.opacity;
    expect(alpha(.62)).toBe(0);
    expect(alpha(.8)).toBeGreaterThan(0); expect(alpha(.8)).toBeLessThan(1);
    expect(alpha(.9)).toBeGreaterThan(alpha(.8)); expect(alpha(1)).toBeCloseTo(1);
    expect(presentWebDetail(points, [], { ...view(.62), index }).some(p => p.node.id === child)).toBe(true);
  });
});
