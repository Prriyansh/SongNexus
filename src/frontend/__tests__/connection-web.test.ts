import { describe, expect, it } from 'vitest';
import type { ArtistDetails } from '@/lib/types';
import { artistTags, buildConnectionWeb, discoveryGenres, genreJourney, mergeDiscoveryArtists, positionWebInViewport } from '../connection-web';
import type { DiscoveryArtist } from '../connection-web';
import { graphFit } from '../graph-layout';
import { buildPath, comparisonFor, defaultWeb, parseRoute } from '../routing';
import { collab, OLIVIA, oliviaDetails, PHOEBE, TAYLOR, taylorDetails, vampireDetails } from './fixtures';

const artist = (id: string, genre: string): ArtistDetails => ({ ...oliviaDetails, id, name: id, tags: [genre], genres: [{ name: genre, count: 10 }] });
const discovered = (journey: string[]): DiscoveryArtist[] => journey.flatMap((genre, i) => Array.from({ length: 3 }, (_, j) => ({
  ...oliviaDetails, id: `context-${i}-${j}`, name: `Artist ${i}-${j}`, tags: [genre], neighborhood: genre,
})));

describe('Connection Web scope and evidence', () => {
  it('widens content and world bounds for folk and J-pop compared with two folk artists', () => {
    const nearJourney = genreJourney(['folk'], ['folk']);
    const farJourney = genreJourney(['folk'], ['j-pop']);
    expect(nearJourney).toEqual(['folk']);
    expect(farJourney[0]).toBe('folk');
    expect(farJourney.at(-1)).toBe('j-pop');
    expect(farJourney).toContain('pop');
    expect(farJourney.length).toBeGreaterThan(2);
    const near = buildConnectionWeb({ mode: 'comparison', a: artist('a', 'folk'), b: artist('b', 'folk') }, discovered(nearJourney), nearJourney);
    const far = buildConnectionWeb({ mode: 'comparison', a: artist('a', 'folk'), b: artist('b', 'j-pop') }, discovered(farJourney), farJourney);
    expect(far.nodes.length).toBeGreaterThan(near.nodes.length);
    expect(far.width).toBeGreaterThan(near.width);
    expect(graphFit(far.width, far.height, 800, 500)).toBeLessThan(graphFit(near.width, near.height, 800, 500));
    expect(far.nodes.some(n => !far.path.includes(n.id) && n.x > far.nodes[0].x && n.x < far.nodes[1].x)).toBe(true);
  });

  it('keeps actual credit paths and sources while discovering surrounding artists', () => {
    const graph = buildConnectionWeb({ mode: 'comparison', a: oliviaDetails, b: taylorDetails, collab }, discovered(['pop']), ['pop']);
    expect(graph.pathType).toBe('credits');
    expect(graph.path[0]).toBe(OLIVIA); expect(graph.path.at(-1)).toBe(TAYLOR);
    expect(graph.edges.filter(e => e.category === 'factual').every(e => e.sourceUrls?.length)).toBe(true);
  });

  it('shows similar artists without drawing shared-tag bridges or context edges', () => {
    const candidates = [{ ...oliviaDetails, id: PHOEBE, name: 'Bridge', tags: ['folk', 'pop'], neighborhood: 'folk' }];
    const graph = buildConnectionWeb({ mode: 'comparison', a: artist('a', 'folk'), b: artist('b', 'pop') }, candidates, ['folk', 'pop']);
    expect(graph.nodes.some(n => n.id === PHOEBE)).toBe(true);
    expect(graph.path).toEqual([]);
    expect(graph.pathType).toBeNull();
    expect(graph.edges).toEqual([]);
  });

  it('leaves context unconnected when no shared genre evidence exists', () => {
    const candidate = { ...oliviaDetails, id: PHOEBE, tags: [], neighborhood: 'pop' };
    const graph = buildConnectionWeb({ mode: 'comparison', a: artist('a', 'folk'), b: artist('b', 'j-pop') }, [candidate], ['folk', 'pop', 'j-pop']);
    expect(graph.nodes.some(n => n.id === PHOEBE)).toBe(true);
    expect(graph.edges).toEqual([]); expect(graph.path).toEqual([]);
    expect(artistTags({ ...oliviaDetails, genres: [], tags: ['female', 'american', 'pop'] })).toEqual(['pop']);
  });

  it('builds single-song discovery around the credited performer and never duplicates it', () => {
    const graph = buildConnectionWeb({ mode: 'search', song: vampireDetails, lead: oliviaDetails }, [{ ...oliviaDetails, neighborhood: 'pop' }], ['pop']);
    expect(graph.nodes.map(n => n.id)).toEqual([OLIVIA]);
    expect(graph.nodes[0].entityType).toBe('artist');
    expect(graph.pathType).toBeNull();
  });

  it('bounds a crowded map and places every unique artist within its world', () => {
    const journey = genreJourney(['folk'], ['j-pop']);
    const graph = buildConnectionWeb({ mode: 'comparison', a: artist('a', 'folk'), b: artist('b', 'j-pop') }, [...discovered(journey), ...discovered(journey)], journey);
    expect(graph.nodes.length).toBeLessThanOrEqual(26);
    expect(new Set(graph.nodes.map(n => n.id)).size).toBe(graph.nodes.length);
    for (const node of graph.nodes) { expect(node.x).toBeGreaterThan(0); expect(node.x).toBeLessThan(graph.width); expect(node.y).toBeGreaterThan(0); expect(node.y).toBeLessThan(graph.height); }
    expect(new Set(graph.nodes.map(n => `${n.x},${n.y}`)).size).toBe(graph.nodes.length);
  });

  it('zooms from the closest styles to a broader mix of genres and different artists', () => {
    const close = discoveryGenres(['folk'], ['j-pop'], -1);
    const initial = discoveryGenres(['folk'], ['j-pop'], 0);
    const wide = discoveryGenres(['folk'], ['j-pop'], 1);
    expect(close).toEqual(['folk', 'j-pop']);
    expect(initial.length).toBeGreaterThan(close.length);
    expect(wide.length).toBeGreaterThan(initial.length);
    const source = { mode: 'comparison' as const, a: artist('a', 'folk'), b: artist('b', 'j-pop') };
    const closeGraph = buildConnectionWeb(source, discovered(close), close);
    const wideGraph = buildConnectionWeb(source, discovered(wide), wide);
    expect(new Set(wideGraph.nodes.map(n => n.subtitle)).size).toBeGreaterThan(new Set(closeGraph.nodes.map(n => n.subtitle)).size);
    expect(closeGraph.nodeWidth).toBe(wideGraph.nodeWidth);
    expect(positionWebInViewport(closeGraph, 1000, 500).find(n => n.id === 'a')).toMatchObject(positionWebInViewport(wideGraph, 1000, 500).find(n => n.id === 'a')!);
    expect(wideGraph.edges).toEqual([]);
  });

  it('draws only the documented path and keeps all surrounding artists unlinked', () => {
    const graph = buildConnectionWeb({ mode: 'comparison', a: oliviaDetails, b: taylorDetails, collab }, discovered(['pop']), ['pop']);
    expect(graph.edges).toHaveLength(2);
    for (const edge of graph.edges) { expect(edge.category).toBe('factual'); expect(edge.onPath).toBe(true); expect(graph.path).toContain(edge.from); expect(graph.path).toContain(edge.to); }
  });

  it('scatters artists reproducibly without overlapping their avatar and label cards', () => {
    const journey = genreJourney(['folk'], ['j-pop']);
    const graph = buildConnectionWeb({ mode: 'comparison', a: artist('a', 'folk'), b: artist('b', 'j-pop') }, discovered(journey), journey);
    const nodes = positionWebInViewport(graph, 1100, 560);
    expect(new Set(nodes.map(n => n.y)).size).toBe(nodes.length);
    const reordered = { ...graph, nodes: [...graph.nodes.filter(n => n.role), ...graph.nodes.filter(n => !n.role).reverse()] };
    const again = positionWebInViewport(reordered, 1100, 560);
    for (const node of nodes) expect(again.find(n => n.id === node.id)).toEqual(node);
    for (let i = 0; i < nodes.length; i++) for (const other of nodes.slice(i + 1)) {
      expect(Math.hypot(nodes[i].x - other.x, nodes[i].y - other.y)).toBeGreaterThan(100);
    }
  });

  it('appends local discoveries while retaining old IDs and world positions', () => {
    const source = { mode: 'comparison' as const, a: oliviaDetails, b: taylorDetails, collab };
    const initialPool = discovered(['pop']);
    const initial = buildConnectionWeb(source, initialPool, ['pop']);
    const positions = positionWebInViewport(initial, 1100, 560);
    const extra = { ...oliviaDetails, id: PHOEBE, name: 'Local discovery', neighborhood: 'indie folk', originId: OLIVIA, focus: { x: 300, y: 260 } };
    const pool = mergeDiscoveryArtists(initialPool, [extra]);
    const next = buildConnectionWeb(source, pool, ['indie folk']);
    const after = positionWebInViewport(next, 1100, 560, positions);
    for (const old of positions) {
      const kept = after.find(n => n.id === old.id)!;
      expect([kept.x, kept.y]).toEqual([old.x, old.y]);
    }
    expect(after.length).toBe(positions.length + 1);
    expect(next.edges).toEqual(initial.edges);
  });

  it('uses real shared membership for a path, but never country or genre alone', () => {
    const band = { ...oliviaDetails, id: PHOEBE, name: 'A shared band', type: 'Group' };
    const a = { ...oliviaDetails, relationships: [{ artist: band, type: 'member of band', ended: true }] };
    const b = { ...taylorDetails, relationships: [{ artist: band, type: 'member of band' }] };
    const graph = buildConnectionWeb({ mode: 'comparison', a, b }, [], ['pop']);
    expect(graph.path).toEqual([OLIVIA, PHOEBE, TAYLOR]);
    expect(graph.edges.every(e => e.category === 'factual' && e.sourceUrls?.length)).toBe(true);
  });
});

describe('Connection Web URLs', () => {
  it('round-trips both modes and their independent selections', () => {
    for (const mode of ['search', 'comparison'] as const) {
      const selection = { ...defaultWeb(), left: PHOEBE, mode };
      const url = new URL(buildPath('connections', comparisonFor('song'), 'a note', false, selection), 'http://localhost');
      const route = parseRoute(url.pathname, url.search);
      expect(route.page).toBe('connections'); expect(route.web).toEqual(selection); expect(route.note).toBe('a note');
    }
  });
  it('sanitizes invalid selections and prevents comparing an artist with themself', () => {
    const route = parseRoute('/connections', `?artistA=${PHOEBE}&artistB=${PHOEBE}&song=bad&mode=invalid`);
    expect(route.web?.left).toBe(PHOEBE); expect(route.web?.right).not.toBe(PHOEBE);
    expect(route.web?.song).toBe(defaultWeb().song); expect(route.web?.mode).toBe('comparison');
  });
});
