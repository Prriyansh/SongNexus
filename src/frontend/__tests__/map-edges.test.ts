// Helen's maps (the similarity map and the two-artist Comparison) in situations the ordinary tests
// don't set up: small screens, ties, stale indexes, cells emptied by a change, artists found from
// someone no longer on the map, duplicate links.
import { describe, expect, it } from 'vitest';
import type { SimilarNode, SimilarWeb } from '@/lib/types';
import type { GraphNode } from '../graph-layout';
import { buildWebDetailIndex as similarIndex, focusAt, webDetailOpacity } from '../similar-detail';
import { buildWebEdges, connectionsOf, discoveredNodes, placeDiscovered } from '../similar-web';
import type { DiscoveredNode, WebNode } from '../similar-web';
import { buildWebDetailIndex as comparisonIndex, presentWebDetail } from '../web-detail';
import { focusArtistAt, initialWebCamera } from '../web-navigation';
import { similarWeb } from './fixtures';

const similar = (id: string, x: number, y: number, extra: Partial<WebNode> = {}): WebNode => ({
  kind: 'artist', id, name: id, subtitle: 'pop', imageUrl: null, similarity: .5, rank: 0, listeners: null, reasons: [], x, y, isCenter: false, ...extra,
});
const peer = (id: string, x: number, y: number, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, entityType: 'artist', label: id, subtitle: '', x, y, ...extra,
});
const camera = { ...initialWebCamera() };

describe('the similarity map’s detail', () => {
  it('uses fewer cells on a small screen', () => {
    const index = similarIndex([similar('a', 10, 10)], 700, 400);
    expect([index.columns, index.rows]).toEqual([2, 1]);
  });

  it('breaks ties by id, and copes with neighbouring cells a change emptied', () => {
    const first = similarIndex([similar('b', 100, 100), similar('a', 100, 100), similar('c', 500, 100)], 1200, 600);
    expect(first.cells.get('0:0')!.ids).toEqual(['a', 'b']);
    // c is gone; its cell stays, empty, next to where d lands.
    const next = similarIndex([similar('a', 100, 100), similar('b', 100, 100), similar('d', 450, 120)], 1200, 600, first);
    expect(next.cells.get('1:0')!.ids).toEqual(['d']);
  });

  it('skips artists an older index still lists', () => {
    const nodes = [similar('a', 100, 100), similar('b', 120, 100)];
    const index = similarIndex(nodes, 1200, 600);
    const opacity = webDetailOpacity([nodes[0]], { width: 1200, height: 600, camera, index });
    expect(opacity.has('b')).toBe(false);
  });

  it('explores around the first of two artists equally near the pointer', () => {
    expect(focusAt([similar('b', 0, 0), similar('a', 10, 0), similar('c', 20, 0)], { x: 10, y: 0 }, camera).nodeId).toBe('a');
    expect(focusAt([similar('b', 0, 0), similar('a', 20, 0)], { x: 10, y: 0 }, camera).nodeId).toBe('a');
  });
});

describe('the similarity map’s lines and discoveries', () => {
  const web: SimilarWeb = { ...similarWeb, links: [
    { from: similarWeb.artists[0].id, to: similarWeb.artists[1].id, kind: 'listeners' },
    { from: similarWeb.artists[1].id, to: similarWeb.artists[0].id, kind: 'listeners' },
    { from: similarWeb.artists[0].id, to: 'not-on-the-map', kind: 'listeners' },
  ] };

  it('draws a listeners line once, whichever way it was listed', () => {
    expect(buildWebEdges(web).filter(e => e.kind === 'neighbour')).toHaveLength(2); // the pair, and the one to someone not shown
  });

  it('names only connections that are on the map', () => {
    expect(connectionsOf(similarWeb.artists[0].id, web)).toEqual([similarWeb.artists[1].name]);
  });

  it('takes equally close discoveries in id order, and places none from someone not on the map', () => {
    const found = (id: string): SimilarNode => ({ ...similarWeb.artists[0], id, name: id, similarity: .4 });
    const discoveries = [{ via: { id: 'gone', name: 'Gone' }, zoom: 1.4, similar: { ...similarWeb, artists: [found('z'), found('y')] } }];
    const nodes = discoveredNodes(similarWeb, discoveries);
    expect(nodes.map(n => n.id)).toEqual(['y', 'z']);
    expect(placeDiscovered([similar('base', 0, 0)], nodes as DiscoveredNode[])).toHaveLength(1);
  });
});

describe('the Comparison map’s detail', () => {
  const W = 1200, H = 600;

  it('gives “unknown” and “related artist” no style, and ranks styled artists first', () => {
    const nodes = [peer('styled', 100, 100, { discoveryGenre: 'jazz' }), peer('unknown', 100, 100, { discoveryGenre: 'Unknown' }), peer('related', 100, 100, { discoveryGenre: 'related artist' }), peer('none', 100, 100)];
    expect(comparisonIndex(nodes, [], W, H).cells.get('0:0')!.ids).toEqual(['styled', 'none', 'related', 'unknown']);
  });

  it('keeps an overview pick still on the map, drops one that left, and skips cells with only deeper finds', () => {
    const nodes = [peer('a', 100, 100), peer('b', 1000, 100), peer('deep', 100, 500, { discoveryZoom: 1.5 })];
    const first = comparisonIndex(nodes, [], W, H);
    const next = comparisonIndex([nodes[0], nodes[2]], [], W, H, first);
    expect([...next.overview.values()]).toEqual(['a']);
    expect(next.overview.size).toBe(1); // the cell with only "deep" gives no overview pick
  });

  it('copes with neighbouring cells a change emptied', () => {
    const first = comparisonIndex([peer('a', 100, 100), peer('c', 500, 100)], [], W, H);
    const next = comparisonIndex([peer('a', 100, 100), peer('d', 450, 140)], [], W, H, first);
    expect(next.cells.get('1:0')!.ids).toEqual(['d']);
  });

  it('shows a new artist an older index doesn’t list yet as hidden', () => {
    const index = comparisonIndex([peer('a', 100, 100)], [], W, H);
    const shown = presentWebDetail([peer('a', 100, 100), peer('new', 120, 100)], [], { width: W, height: H, camera, index });
    expect(shown.find(s => s.node.id === 'new')!.opacity).toBe(0);
  });

  it('has no artist to explore around on an empty map', () => {
    expect(focusArtistAt([], { x: 0, y: 0 }, camera)).toBeNull();
  });
});

describe('the last few map cases', () => {
  it('drops an overview pick on the similarity map once its artist leaves', () => {
    const nodes = [similar('a', 100, 100), similar('b', 1000, 100)];
    const first = similarIndex(nodes, 1200, 600);
    expect([...similarIndex([nodes[0]], 1200, 600, first).overview.values()]).toEqual(['a']);
  });

  it('ignores links between two other artists when naming connections', () => {
    const [x, y, z] = similarWeb.artists.length >= 3 ? similarWeb.artists : [...similarWeb.artists, ...similarWeb.songs];
    const web: SimilarWeb = { ...similarWeb, links: [{ from: y.id, to: z.id, kind: 'listeners' }] };
    expect(connectionsOf(x.id, web)).toEqual([]);
  });

  it('draws listening lines from a discovery only when they touch something it added', async () => {
    const { discoveryEdges } = await import('../similar-web');
    const [a, b] = similarWeb.artists;
    const found = [{ ...a, id: 'new', via: { id: a.id, name: a.name }, discoveryZoom: 1.4 }] as DiscoveredNode[];
    const discoveries = [{ via: found[0].via, zoom: 1.4, similar: { ...similarWeb, links: [{ from: a.id, to: b.id, kind: 'listeners' as const }, { from: 'new', to: b.id, kind: 'listeners' as const }] } }];
    const edges = discoveryEdges(found, discoveries, new Set([a.id, b.id, 'new']));
    expect(edges.filter(e => e.kind === 'neighbour')).toEqual([{ from: 'new', to: b.id, kind: 'neighbour', strength: 1 }]);
  });
});

describe('songs on the similarity map', () => {
  it('group a song without a named artist by its subtitle', () => {
    const songs = [similar('s1', 100, 100, { kind: 'song', subtitle: 'Band' }), similar('s2', 100, 100, { kind: 'song', artist: 'band', subtitle: 'x' })];
    // Same style ("song:band"), so variety doesn't separate them and id order decides.
    expect(similarIndex(songs, 1200, 600).cells.get('0:0')!.ids).toEqual(['s1', 's2']);
  });
});
