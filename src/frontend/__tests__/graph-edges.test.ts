// The comparison graph and Helen's layout for pairs the ordinary tests don't use: songs sharing a
// featured artist, collaborators credited only as writers, artists with no genre, lines that
// skip columns, edges to people who aren't drawn.
import { describe, expect, it } from 'vitest';
import type { CollaboratorComparison, RecordingDetails } from '@/lib/types';
import { buildGraph, songArtistPair } from '../graph';
import type { GraphInput } from '../graph';
import { layoutComparison, routeGraphEdges } from '../graph-layout';
import type { GraphEdge, GraphNode } from '../graph-layout';
import { collab, NIGRO, OLIVIA, oliviaDetails, opheliaDetails, SERBAN, TAYLOR, taylorDetails, VAMPIRE, vampireDetails } from './fixtures';

const noCredits: CollaboratorComparison = { ...collab, mutual: [], direct: { bOnA: [], aOnB: [] } };
const song = (base: RecordingDetails, artists: RecordingDetails['artists'], extra: Partial<RecordingDetails> = {}): RecordingDetails => ({ ...base, artists, ...extra });
const songs = (a: RecordingDetails, b: RecordingDetails, extra: Partial<Extract<GraphInput, { kind: 'song' }>> = {}): GraphInput =>
  ({ kind: 'song', a, b, collab: noCredits, role: 'all', ...extra });

describe('song pairs', () => {
  const FEAT = 'ee000000-0000-4000-8000-000000000001';

  it('aren’t a pair of different artists when they share any credited artist', () => {
    const a = song(vampireDetails, [{ id: OLIVIA, name: 'Olivia Rodrigo' }, { id: FEAT, name: 'Feature' }]);
    const b = song(opheliaDetails, [{ id: TAYLOR, name: 'Taylor Swift' }, { id: FEAT, name: 'Feature' }]);
    expect(songArtistPair(a, b)).toBeNull();
  });

  it('leave out credited artists without an id, and draw no genre line without shared genres', () => {
    const a = song(vampireDetails, [{ id: OLIVIA, name: 'Olivia Rodrigo' }, { id: null, name: 'Uncredited' }], { genres: [{ name: 'pop', count: 1 }] });
    const b = song(opheliaDetails, [{ id: TAYLOR, name: 'Taylor Swift' }], { genres: [{ name: 'country', count: 1 }] });
    const graph = buildGraph(songs(a, b), [], false);
    expect(graph.nodes.some(n => n.label === 'Uncredited')).toBe(false);
    expect(graph.edges.some(e => e.category === 'similarity')).toBe(false);
  });

  it('make a direct credit the whole path, and have no path without a collaborator', () => {
    const direct = buildGraph(songs(vampireDetails, opheliaDetails, { collab: { ...noCredits, direct: { bOnA: [{ id: VAMPIRE, title: 'vampire' }], aOnB: [] } } }), [], false);
    expect(direct.path).toEqual([vampireDetails.id, OLIVIA, TAYLOR, opheliaDetails.id]);
    expect(buildGraph(songs(vampireDetails, opheliaDetails), [], false).path).toEqual([]);
  });

  it('wait for collaborators before drawing a path through them', () => {
    expect(buildGraph(songs(vampireDetails, opheliaDetails, { collab: undefined }), [], false).path).toEqual([]);
  });
});

describe('artist pairs', () => {
  const input = (extra: Partial<Extract<GraphInput, { kind: 'artist' }>> = {}): GraphInput =>
    ({ kind: 'artist', a: oliviaDetails, b: taylorDetails, collab, role: 'all', ...extra });

  it('call an artist without a genre by their type, or just “Artist”', () => {
    const graph = buildGraph(input({ a: { ...oliviaDetails, genres: [] }, b: { ...taylorDetails, genres: [], type: '' } }), [], false);
    expect(graph.nodes.find(n => n.id === OLIVIA)!.subtitle).toBe('Person');
    expect(graph.nodes.find(n => n.id === TAYLOR)!.subtitle).toBe('Artist');
  });

  it('put a writer-only collaborator on the path when no one else worked on both', () => {
    const writers = { ...collab, mutual: collab.mutual.map(c => ({ ...c, roles: { a: ['songwriting'], b: ['songwriting'] } })) };
    expect(buildGraph(input({ collab: writers }), [], false).path).toEqual([OLIVIA, writers.mutual[0].id, TAYLOR]);
  });

  it('have no path without a collaborator or a direct credit', () => {
    expect(buildGraph(input({ collab: noCredits }), [], false).path).toEqual([]);
  });

  it('show a song once when it connects a collaborator on both sides', () => {
    const shared = { id: 'track', title: 'Shared track' };
    const both = { ...collab, mutual: [{ ...collab.mutual[0], tracks: { a: [shared], b: [shared] } }] };
    const graph = buildGraph(input({ collab: both }), [SERBAN], false);
    expect(graph.nodes.filter(n => n.id === 'track')).toHaveLength(1);
    void NIGRO;
  });
});

describe('Helen’s layout', () => {
  const node = (id: string): GraphNode => ({ id, entityType: 'artist', label: id, subtitle: '', x: 0, y: 0 });
  const edge = (from: string, to: string, category: GraphEdge['category'] = 'factual'): GraphEdge => ({ from, to, category, label: '', detail: '' });

  it('places people linked from either end, and anyone unlinked in the middle', () => {
    const graph = layoutComparison([node('a'), node('b'), node('m'), node('lonely'), node('via')], [edge('a', 'm'), edge('via', 'b'), edge('via', 'lonely2')], ['a', 'b'], []);
    const x = (id: string) => graph.nodes.find(n => n.id === id)!.x;
    expect(x('m')).toBe(x('a')); // linked only to a, so in a's column
    expect(x('lonely')).toBe((x('a') + x('b')) / 2); // no line, so the column between the two
    expect(x('via')).toBeGreaterThan(x('a'));
  });

  it('routes lines that skip a column over the graph for credits and under it for genres, and drops lines to missing cards', () => {
    const graph = layoutComparison([node('a'), node('m'), node('b')], [], ['a', 'm', 'b'], ['a', 'm', 'b']);
    const routed = routeGraphEdges({ ...graph, edges: [edge('a', 'b'), edge('b', 'a', 'similarity'), edge('a', 'gone')] });
    expect(routed).toHaveLength(2);
    const [over, under] = routed;
    expect(over.d).toContain(` C ${graph.nodes[0].x} 14 `);
    expect(under.d).toContain(` ${graph.height - 14} `);
  });

  it('routes within a single column', () => {
    const graph = layoutComparison([node('a')], [], ['a'], []);
    expect(routeGraphEdges({ ...graph, edges: [edge('a', 'a')] })).toHaveLength(1);
  });
});
