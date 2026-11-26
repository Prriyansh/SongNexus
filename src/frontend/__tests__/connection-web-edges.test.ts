// Helen's two-artist Comparison mode with inputs the ordinary tests don't use: tags the genre map
// doesn't know, a band both artists were in, a direct relationship, a song by uncredited artists,
// a crowd too dense to place someone in, more discoveries than fit.
import { describe, expect, it } from 'vitest';
import type { ArtistDetails, DiscoveryReason, RecordingDetails } from '@/lib/types';
import { buildConnectionWeb, discoveryGenres, genreJourney, mergeDiscoveryArtists, positionWebInViewport } from '../connection-web';
import type { DiscoveryArtist, WebGraph } from '../connection-web';
import type { GraphNode } from '../graph-layout';
import { OLIVIA, oliviaDetails, TAYLOR, taylorDetails, vampireDetails } from './fixtures';

const BAND = 'bb000000-0000-4000-8000-000000000001';
const member = (artist: { id: string; name: string }, end?: string) => ({ artist: { ...oliviaDetails, ...artist }, type: 'member of band', end });

describe('genre journeys', () => {
  it('start or end with whatever one side has', () => {
    expect(genreJourney([], ['jazz'])).toEqual(['jazz']);
    expect(genreJourney([], [])).toEqual([]);
    expect(genreJourney(['made-up'])).toEqual(['made-up']);
  });

  it('meet in the middle when the map can’t connect two unknown styles', () => {
    expect(genreJourney(['zzz', 'yyy'], ['qqq', 'www'])).toEqual(['zzz', 'yyy', 'www', 'qqq']);
  });

  it('widen with zoom, from one side alone, and through styles the map doesn’t know', () => {
    expect(discoveryGenres(['folk'], undefined, -1)).toEqual(['folk']);
    expect(discoveryGenres(['folk'], ['jazz'], 1).length).toBeGreaterThanOrEqual(8);
    expect(discoveryGenres(['folk'], ['jazz'], 2)).toHaveLength(12);
    expect(discoveryGenres(['made-up'], ['made-up'], 1)).toEqual(['made-up']);
  });
});

describe('merging discoveries', () => {
  const reason = (text: string): DiscoveryReason => ({ kind: 'genre', text, sourceUrl: 'u', relatedTo: OLIVIA });
  const found = (id: string, reasons?: DiscoveryReason[]): DiscoveryArtist => ({ ...oliviaDetails, id, name: id, neighborhood: 'pop', reasons, country: '' });

  it('keeps each reason once, and the earlier country', () => {
    const [merged] = mergeDiscoveryArtists([{ ...found('a', [reason('one')]), country: 'US' }], [found('a', [reason('one'), reason('two')]), found('a')]);
    expect(merged.reasons!.map(r => r.text)).toEqual(['one', 'two']);
    expect(merged.country).toBe('US');
  });

  it('stops adding new artists at 120, but still merges into ones it has', () => {
    const many = Array.from({ length: 120 }, (_, i) => found(`a${i}`));
    const merged = mergeDiscoveryArtists(many, [found('new'), found('a0', [reason('more')])]);
    expect(merged).toHaveLength(120);
    expect(merged[0].reasons!.map(r => r.text)).toEqual(['more']);
  });
});

describe('the Comparison web', () => {
  const comparison = (a: ArtistDetails, b: ArtistDetails) => buildConnectionWeb({ mode: 'comparison', a, b }, [], ['pop']);

  it('draws a documented relationship between the two as the path, saying when it ended', () => {
    const a = { ...oliviaDetails, relationships: [{ ...member({ id: TAYLOR, name: 'Taylor Swift' }, '2020'), type: 'collaboration' }] };
    const web = comparison(a, taylorDetails);
    expect(web.path).toEqual([OLIVIA, TAYLOR]);
    expect(web.edges[0].detail).toBe('Olivia Rodrigo and Taylor Swift: collaboration (ended 2020).');
    const ongoing = comparison({ ...oliviaDetails, relationships: [{ ...member({ id: TAYLOR, name: 'Taylor Swift' }), type: 'collaboration' }] }, taylorDetails);
    expect(ongoing.edges[0].detail).toBe('Olivia Rodrigo and Taylor Swift: collaboration.');
  });

  it('goes through a band both were in, named for what the first artist is', () => {
    const band = { id: BAND, name: 'The Band' };
    const person = comparison({ ...oliviaDetails, type: 'Person', relationships: [member(band)] }, { ...taylorDetails, relationships: [member(band)] });
    expect(person.path).toEqual([OLIVIA, BAND, TAYLOR]);
    expect(person.nodes.find(n => n.id === BAND)!.subtitle).toBe('Shared band');
    const group = comparison({ ...oliviaDetails, type: 'Group', relationships: [member(band)] }, { ...taylorDetails, relationships: [member(band)] });
    expect(group.nodes.find(n => n.id === BAND)!.subtitle).toBe('Shared member');
  });

  it('finds no shared band when the second artist has no relationships at all', () => {
    const web = comparison({ ...oliviaDetails, relationships: [member({ id: BAND, name: 'The Band' })] }, { ...taylorDetails, relationships: undefined });
    expect(web.path).toEqual([]);
  });

  it('is narrower on small screens, and spreads one style’s discoveries across columns', () => {
    const discovered = [0, 1, 2].map(i => ({ ...oliviaDetails, id: `d${i}`, name: `D${i}`, neighborhood: 'pop' } as DiscoveryArtist));
    const wide = buildConnectionWeb({ mode: 'comparison', a: oliviaDetails, b: taylorDetails }, discovered, ['pop']);
    const narrow = buildConnectionWeb({ mode: 'comparison', a: oliviaDetails, b: taylorDetails }, discovered, ['pop'], true);
    expect(narrow.width).toBeLessThan(wide.width);
    expect(new Set(wide.nodes.filter(n => n.id.startsWith('d')).map(n => Math.round(n.x / 100))).size).toBeGreaterThan(1);
    expect(wide.nodes.find(n => n.id === 'd0')!.subtitle).toBe('Pop');
  });
});

describe('the song web', () => {
  const song = (artists: RecordingDetails['artists']): RecordingDetails => ({ ...vampireDetails, artists, genres: [{ name: 'Pop', count: 1 }] });

  it('anchors only credited artists with an id, and describes those that aren’t the lead', () => {
    const web = buildConnectionWeb({ mode: 'search', song: song([{ id: OLIVIA, name: 'Olivia Rodrigo' }, { id: null, name: 'Uncredited' }, { id: TAYLOR, name: 'Taylor Swift' }]), lead: oliviaDetails }, [], ['pop']);
    expect(web.nodes.map(n => n.id)).toEqual([OLIVIA, TAYLOR]);
    expect(web.nodes[1]).toMatchObject({ subtitle: 'Credited performer', artUrl: vampireDetails.representative?.artUrl, discoveryGenre: 'pop' });
  });

  it('calls a lead with no style tags a performer, and works without a lead', () => {
    const tagless = { ...oliviaDetails, genres: [], tags: [] };
    expect(buildConnectionWeb({ mode: 'search', song: song([{ id: OLIVIA, name: 'Olivia' }]), lead: tagless }, [], []).nodes[0].subtitle).toBe('Performer');
    expect(buildConnectionWeb({ mode: 'search', song: song([{ id: OLIVIA, name: 'Olivia' }]) }, [], []).nodes[0].subtitle).toBe('Credited performer');
  });
});

describe('placing the web in the viewport', () => {
  const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({ id, entityType: 'artist', label: id, subtitle: '', x: 0, y: 0, ...extra });
  const graph = (nodes: GraphNode[], extra: Partial<WebGraph> = {}): WebGraph =>
    ({ nodes, edges: [], width: 1000, height: 600, nodeWidth: 132, expandable: [], path: [], pathType: null, journey: [], ...extra });

  it('forgets where artists no longer shown were', () => {
    const placed = positionWebInViewport(graph([node('a', { role: 'anchor' })]), 1000, 600, [node('gone', { x: 5, y: 5 })]);
    expect(placed.map(n => n.id)).toEqual(['a']);
  });

  it('places a discovery near its anchor, or the middle when the anchor isn’t placed', () => {
    const anchored = positionWebInViewport(graph([node('a', { role: 'anchor' }), node('d', { discoveryAnchor: 'a' })]), 1000, 600);
    const orphan = positionWebInViewport(graph([node('a', { role: 'anchor' }), node('d', { discoveryAnchor: 'missing' })]), 1000, 600);
    expect(Math.abs(anchored[1].x - anchored[0].x)).toBeLessThan(400);
    expect(Number.isFinite(orphan[1].x)).toBe(true);
  });

  it('puts someone with no room nearby off to the side, to pan to', () => {
    // A wall of anchors every 100 px, with cards so wide nothing fits between them.
    const walls = Array.from({ length: 41 }, (_, i) => node(`w${i}`, { role: 'anchor', x: 500, y: -1700 + i * 100 }));
    const placed = positionWebInViewport(graph([...walls, node('late')], { nodeWidth: 1e7 }), 1000, 600, walls);
    expect(placed.at(-1)!.x).toBeGreaterThan(1000);
  });
});

describe('the Comparison web’s last cases', () => {
  it('keeps a collaborator found by credits beside the path when a direct relationship becomes it', async () => {
    const { collab, SERBAN } = await import('./fixtures');
    const a = { ...oliviaDetails, relationships: [{ ...member({ id: TAYLOR, name: 'Taylor Swift' }), type: 'collaboration' }] };
    const web = buildConnectionWeb({ mode: 'comparison', a, b: taylorDetails, collab }, [], ['pop']);
    expect(web.path).toEqual([OLIVIA, TAYLOR]);
    const serban = web.nodes.find(n => n.id === SERBAN)!;
    expect(serban.x).toBeGreaterThan(web.nodes.find(n => n.id === OLIVIA)!.x);
  });

  it('lists a discovery’s reasons, and reads styles from tags alone for a plain search result', async () => {
    const { phoebe } = await import('./fixtures');
    const reasons: DiscoveryReason[] = [{ kind: 'genre', text: 'Similar style: pop', sourceUrl: 'u', relatedTo: OLIVIA }, { kind: 'country', text: 'Also from US', sourceUrl: 'u', relatedTo: OLIVIA }];
    const found = { ...phoebe, tags: ['indie'], neighborhood: 'indie', reasons } as DiscoveryArtist;
    const node = buildConnectionWeb({ mode: 'comparison', a: oliviaDetails, b: taylorDetails }, [found], ['indie', 'pop']).nodes.find(n => n.id === phoebe.id)!;
    expect(node).toMatchObject({ subtitle: 'Similar style: pop', detail: 'Similar style: pop · Also from US', discoveryGenre: 'indie' });
  });
});
