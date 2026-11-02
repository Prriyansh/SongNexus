import { afterEach, describe, expect, it, vi } from 'vitest';
import { artistNeighborhood, mergeRelatedArtists, neighborhoodEra } from '../artist-neighborhood';
import { __clearCache, mapArtistDetails } from '../musicbrainz';
import type { ArtistDetails, RelatedArtist } from '../types';

const id = (n: number) => `aa000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(1), MEMBER = id(2), BAND = id(3), GENRE = id(4), COUNTRY = id(5), ERA = id(6), LABEL_ARTIST = id(7), LABEL = id(8), RELEASE = id(9);
const artist = (gid: string, name: string, type = 'Person') => ({ id: gid, name, type, country: 'GB', tags: [{ name: 'folk', count: 3 }] });
const anchor = { ...artist(A, 'Focus band', 'Group'), genres: [{ name: 'folk', count: 8 }, { name: 'folk rock', count: 4 }],
  'life-span': { begin: '1965' }, relations: [{ type: 'member of band', direction: 'backward', ended: true, end: '2001', artist: artist(MEMBER, 'A member') }] };
const albums = { 'release-group-count': 1, 'release-groups': [{ id: id(10), title: 'Debut', 'primary-type': 'Album', 'first-release-date': '1994-01-01' }] };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

function transport({ failLabels = false, solo = false } = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)), q = url.searchParams;
    if (url.pathname.endsWith(`/artist/${A}`)) return response(solo ? { ...anchor, type: 'Person', relations: [{ type: 'member of band', ended: true, end: '2001', artist: artist(BAND, 'Former group', 'Group') }] } : anchor);
    if (url.pathname.endsWith(`/artist/${MEMBER}`)) return response({ ...artist(MEMBER, 'A member'), relations: [
      { type: 'member of band', artist: artist(A, 'Focus band', 'Group') }, { type: 'member of band', artist: artist(BAND, 'Another band', 'Group') },
    ] });
    if (url.pathname.endsWith('/release-group') && q.has('artist')) return response(albums);
    if (url.pathname.endsWith('/artist')) return response({ artists: q.get('query')?.includes('country:')
      ? [artist(COUNTRY, 'Same country'), { ...artist(id(20), 'Unknown origin'), country: undefined }]
      : [artist(GENRE, 'Same style'), artist(COUNTRY, 'Same country')] });
    if (url.pathname.endsWith('/release-group')) return response({ 'release-groups': [
      { id: id(11), 'first-release-date': '1996-01-01', 'artist-credit': [{ artist: artist(ERA, 'Same era') }] },
      { id: id(12), 'first-release-date': '1980', 'artist-credit': [{ artist: artist(id(21), 'Wrong era') }] },
    ] });
    if (q.has('artist')) return failLabels ? response({ error: 'Unavailable' }, 503) : response({ releases: [{ id: RELEASE, 'label-info': [{ label: { id: LABEL, name: 'Example Records' } }] }] });
    if (q.has('label')) return response({ releases: [{ id: RELEASE, 'artist-credit': [{ artist: artist(LABEL_ARTIST, 'Label peer') }] }] });
    return response({}, 404);
  });
}
const options = (fetchImpl: typeof fetch) => ({ fetchImpl, throttleMs: 0, maxRetries: 0, useCache: false });
afterEach(() => { __clearCache(); vi.restoreAllMocks(); });

describe('source-backed artist neighborhoods', () => {
  it('combines genres, country, album era, sampled labels, members and shared members', async () => {
    const fetchImpl = transport();
    const result = await artistNeighborhood(A, options(fetchImpl));
    expect(result.failed).toEqual([]);
    const kinds = new Set(result.artists.flatMap(a => a.reasons.map(r => r.kind)));
    for (const kind of ['genre', 'country', 'era', 'label', 'member', 'shared-member'] as const) expect(kinds.has(kind)).toBe(true);
    expect(result.artists.find(a => a.id === LABEL_ARTIST)?.reasons[0].text).toBe('Release on Example Records');
    expect(result.artists.find(a => a.id === BAND)?.reasons[0].text).toBe('Shared member: A member');
    expect(result.artists.find(a => a.id === MEMBER)?.reasons[0].text).toContain('Former member');
    expect(result.artists.every(a => a.reasons.every(r => r.sourceUrl.startsWith('https://musicbrainz.org/')))).toBe(true);
    expect(result.artists.some(a => a.id === id(21))).toBe(false);
    expect(result.artists.some(a => a.id === id(20))).toBe(false);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('includes a documented former band without asserting current membership', async () => {
    const result = await artistNeighborhood(A, options(transport({ solo: true })));
    expect(result.artists.find(a => a.id === BAND)?.reasons[0].text).toBe('Former band: Former group');
  });

  it('does not treat a person’s birth year as a musical era', () => {
    const person = mapArtistDetails({ ...artist(A, 'Singer'), 'life-span': { begin: '1950-04-01' } });
    expect(neighborhoodEra(person)).toBeNull();
    expect(neighborhoodEra({ ...person, type: 'Group' })).toEqual([1950, 1959]);
    expect(neighborhoodEra({ ...person, discography: { firstYear: '1994' } as ArtistDetails['discography'] })).toEqual([1990, 1999]);
  });

  it('preserves successful facets when label discovery fails', async () => {
    const result = await artistNeighborhood(A, options(transport({ failLabels: true })));
    expect(result.failed).toEqual(['labels']);
    expect(result.artists.some(a => a.id === GENRE)).toBe(true);
    expect(result.artists.some(a => a.id === BAND)).toBe(true);
  });

  it('merges evidence and ranks multiple supported similarities above a single tag', () => {
    const base = mapArtistDetails(artist(GENRE, 'A peer'));
    const reason = (kind: 'genre' | 'country') => ({ kind, text: kind, sourceUrl: `https://musicbrainz.org/artist/${GENRE}`, relatedTo: A });
    const result = mergeRelatedArtists([
      { ...base, reasons: [reason('genre')] }, { ...base, reasons: [reason('country')] },
      { ...base, id: COUNTRY, reasons: Array.from({ length: 8 }, (_, i) => ({ ...reason('genre'), text: `Style ${i}` })) },
    ] as RelatedArtist[]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(GENRE);
    expect(result[0].reasons).toHaveLength(2);
  });
});
