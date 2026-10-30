import { describe, expect, it } from 'vitest';
import { buildGraph, matchesRole, songArtistPair } from '../graph';
import type { GraphInput } from '../graph';
import { routeGraphEdges } from '../graph-layout';
import type { GraphEdge } from '../graph-layout';
import { BRYCE, SOUR_ART, collab, MAKING_THE_BED, NIGRO, OLIVIA, oliviaDetails, OPHELIA, opheliaDetails, SERBAN, TAYLOR, taylorDetails, VAMPIRE, vampireDetails } from './fixtures';

const artists = (extra: Partial<Extract<GraphInput, { kind: 'artist' }>> = {}): GraphInput =>
  ({ kind: 'artist', a: oliviaDetails, b: taylorDetails, collab, role: 'all', ...extra });
const ids = (graph: { nodes: { id: string }[] }) => graph.nodes.map(n => n.id);
const factual = (graph: { edges: GraphEdge[] }) => graph.edges.filter(e => e.category === 'factual');

describe('buildGraph: artists', () => {
  it('anchors both artists and links each mutual collaborator to both', () => {
    const graph = buildGraph(artists(), [], false);
    expect(graph.nodes.filter(n => n.role === 'Comparison anchor').map(n => n.id)).toEqual([OLIVIA, TAYLOR]);
    expect(ids(graph)).toEqual(expect.arrayContaining([SERBAN, BRYCE, NIGRO]));
    for (const person of [SERBAN, BRYCE, NIGRO]) {
      expect(factual(graph).filter(e => [e.from, e.to].includes(person))).toHaveLength(2);
    }
    expect(graph.nodes.find(n => n.id === SERBAN)).toMatchObject({ contributor: true, entityType: 'artist', subtitle: 'Mixing' });
    expect(graph.nodes.find(n => n.id === OLIVIA)?.artUrl).toBe(SOUR_ART);
  });

  it('explains each credit edge with the songs behind it and MusicBrainz sources', () => {
    const edge = buildGraph(artists(), [], false).edges.find(e => e.from === OLIVIA && e.to === SERBAN)!;
    expect(edge.label).toBe('Mixing');
    expect(edge.detail).toContain('12 of Olivia Rodrigo’s scanned tracks, including “vampire”, “making the bed”');
    expect(edge.sourceUrls).toEqual([`https://musicbrainz.org/recording/${VAMPIRE}`, `https://musicbrainz.org/recording/${MAKING_THE_BED}`]);
  });

  it('routes the factual path through the strongest collaborator', () => {
    const graph = buildGraph(artists(), [], false);
    expect(graph.path).toEqual([OLIVIA, SERBAN, TAYLOR]);
    expect(graph.edges.filter(e => e.onPath)).toHaveLength(2);
  });

  it('prefers a direct credit for the path', () => {
    const direct = { ...collab, direct: { bOnA: [{ id: VAMPIRE, title: 'vampire' }], aOnB: [] } };
    const graph = buildGraph(artists({ collab: direct }), [], false);
    expect(graph.path).toEqual([OLIVIA, TAYLOR]);
    const edge = factual(graph).find(e => e.from === OLIVIA && e.to === TAYLOR)!;
    expect(edge.detail).toBe('Taylor Swift is credited on Olivia Rodrigo’s “vampire”.');
  });

  it('keeps a songwriting credit off the path, and says what it is', () => {
    const writing = { bOnA: [{ id: VAMPIRE, title: 'vampire' }], aOnB: [] };
    const graph = buildGraph(artists({ collab: { ...collab, writing } }), [], false);
    expect(graph.path).toEqual([OLIVIA, SERBAN, TAYLOR]);
    const edge = factual(graph).find(e => e.writingOnly)!;
    expect(edge.onPath).toBe(false);
    expect(edge.label).toBe('Songwriting credit');
  });

  it('routes the path through someone who worked on both, over someone who only wrote', () => {
    const writerFirst = { ...collab.mutual[0], id: 'ee000000-0000-4000-8000-000000000001', name: 'Writer Only', roles: { a: ['songwriting'], b: ['songwriting'] }, trackCount: { a: 50, b: 50 } };
    const graph = buildGraph(artists({ collab: { ...collab, mutual: [writerFirst, ...collab.mutual] } }), [], false);
    expect(graph.path).toEqual([OLIVIA, SERBAN, TAYLOR]);
  });

  it('routes every line from card edge to card edge, with no card in the way', () => {
    const graph = buildGraph(artists(), [], false);
    const routes = routeGraphEdges(graph);
    expect(routes).toHaveLength(graph.edges.length);
    const similar = routes.find(r => r.edge.category === 'similarity')!;
    expect(similar.midpoint.y).toBeGreaterThan(Math.max(...graph.nodes.map(n => n.y)));
    const left = graph.nodes.find(n => n.id === OLIVIA)!, right = graph.nodes.find(n => n.id === TAYLOR)!;
    for (const person of [SERBAN, BRYCE, NIGRO]) {
      const node = graph.nodes.find(n => n.id === person)!;
      expect(node.x).toBeGreaterThan(left.x); expect(node.x).toBeLessThan(right.x);
    }
  });

  it('adds a dashed similarity edge for shared genres only', () => {
    const similar = buildGraph(artists(), [], false).edges.filter(e => e.category === 'similarity');
    expect(similar).toHaveLength(1);
    expect(similar[0].detail).toContain('Pop, Pop Rock');
    const none = buildGraph(artists({ b: { ...taylorDetails, genres: [{ name: 'metal', count: 1 }] } }), [], false);
    expect(none.edges.some(e => e.category === 'similarity')).toBe(false);
  });

  it('shows only the anchors (and genre link) while collaborators load', () => {
    const graph = buildGraph(artists({ collab: undefined }), [], false);
    expect(ids(graph)).toEqual([OLIVIA, TAYLOR]);
    expect(graph.path).toEqual([]);
  });

  it('filters collaborators by credited role', () => {
    const graph = buildGraph(artists({ role: 'producer' }), [], false);
    expect(ids(graph)).toEqual([OLIVIA, TAYLOR, NIGRO]);
    expect(matchesRole(collab.mutual[1], 'engineering')).toBe(true);
    expect(matchesRole(collab.mutual[0], 'engineering')).toBe(false);
  });

  it('reveals the connecting songs when a collaborator is expanded', () => {
    const before = buildGraph(artists(), [], false);
    expect(before.expandable).toContain(SERBAN);
    const after = buildGraph(artists(), [SERBAN], false);
    expect(ids(after)).toEqual(expect.arrayContaining([VAMPIRE, MAKING_THE_BED, OPHELIA]));
    expect(after.nodes.find(n => n.id === OPHELIA)).toMatchObject({ entityType: 'song', subtitle: 'Taylor Swift' });
    expect(after.expandable).not.toContain(SERBAN);
  });

  it('shows more collaborators each time an anchor is expanded', () => {
    const many = { ...collab, mutual: Array.from({ length: 12 }, (_, i) => ({ ...collab.mutual[0], id: `ee000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `Person ${i}` })) };
    const count = (expanded: string[]) => buildGraph(artists({ collab: many }), expanded, false).nodes.filter(n => n.contributor).length;
    expect(count([])).toBe(5);
    expect(count([OLIVIA])).toBe(9);
    expect(count([OLIVIA, TAYLOR])).toBe(12);
    expect(buildGraph(artists({ collab: many }), [], false).expandable).toContain(OLIVIA);
  });

  it('lays nodes out with finite positions inside the graph bounds', () => {
    for (const narrow of [false, true]) {
      const graph = buildGraph(artists(), [SERBAN], narrow);
      for (const node of graph.nodes) {
        expect(node.x).toBeGreaterThan(0); expect(node.x).toBeLessThan(graph.width);
        expect(node.y).toBeGreaterThan(0); expect(node.y).toBeLessThan(graph.height);
      }
      expect(new Set(graph.nodes.map(n => `${n.x},${n.y}`)).size).toBe(graph.nodes.length);
    }
  });
});

describe('buildGraph: songs', () => {
  const songs = (extra: Partial<Extract<GraphInput, { kind: 'song' }>> = {}): GraphInput =>
    ({ kind: 'song', a: vampireDetails, b: opheliaDetails, collab, role: 'all', ...extra });

  it('links each song to its artists and the artists through collaborators', () => {
    const graph = buildGraph(songs(), [], false);
    expect(ids(graph).slice(0, 4)).toEqual([VAMPIRE, OPHELIA, OLIVIA, TAYLOR]);
    expect(graph.edges.find(e => e.from === VAMPIRE && e.to === OLIVIA)?.label).toBe('Performed by');
    expect(graph.path).toEqual([VAMPIRE, OLIVIA, SERBAN, TAYLOR, OPHELIA]);
    expect(graph.nodes[0].artUrl).toContain('coverartarchive.org');
  });

  it('connects two songs by the same artist through that artist, without a collaborator scan', () => {
    const other = { ...opheliaDetails, artists: [{ id: OLIVIA, name: 'Olivia Rodrigo' }] };
    expect(songArtistPair(vampireDetails, other)).toBeNull();
    const graph = buildGraph(songs({ b: other, collab: undefined }), [], false);
    expect(graph.path).toEqual([VAMPIRE, OLIVIA, OPHELIA]);
  });

  it('knows which artists to scan for a song pair', () => {
    expect(songArtistPair(vampireDetails, opheliaDetails)).toEqual([{ id: OLIVIA, name: 'Olivia Rodrigo' }, { id: TAYLOR, name: 'Taylor Swift' }]);
    expect(songArtistPair({ ...vampireDetails, artists: [{ id: null, name: 'Unknown' }] }, opheliaDetails)).toBeNull();
  });
});
