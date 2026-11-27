// @vitest-environment jsdom
// The frontend's pure helpers with the inputs their own tests don't send: missing fields,
// unusual spellings, oversize lists, files with Windows line endings, links missing a part.
import { describe, expect, it } from 'vitest';
import type { Artist, ArtistDetails, Song } from '@/lib/types';
import { sourceNote } from '../credits';
import { artistSubtitle, errorText, firstRelease, linkLabel, roleText, songArtists, studioAlbumText } from '../model';
import { matchQuery, parsePlaylist, readCsv } from '../playlist';
import { emptyProfile, parseProfile, songSnapshot } from '../profile';
import type { MusicProfile } from '../profile';
import { comparisonFor, examples } from '../routing';
import { rankSearchResults } from '../search-ranking';
import { applyAnswers } from '../setup';
import { shareUrl } from '../share';
import { friendLink, readStoredPlaylist, tasteNear } from '../taste';
import { killBill, oliviaDetails, phoebe } from './fixtures';

const UUID = (n: number) => `aa000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('source notes', () => {
  it('say when a source couldn’t be reached', () => {
    expect(sourceNote([{ source: 'Genius', status: 'failed' }])).toBe('Genius couldn’t be reached.');
  });
});

describe('pairs and links', () => {
  it('picks the other default when only the second side is the first default', () => {
    const [d1, d2] = examples.artist;
    expect(comparisonFor('artist', null, d1)).toMatchObject({ left: d2, right: d1 });
    expect(comparisonFor('artist', d2, null)).toMatchObject({ left: d2, right: d1 });
  });

  it('shares the default Connection Web when the route names none', () => {
    const route = { page: 'connections' as const, manual: false, comparison: comparisonFor('artist'), note: '' };
    const url = new URL(shareUrl(route, emptyProfile, '', { origin: 'https://x', href: 'https://x/connections', hash: '' }));
    expect(url.searchParams.get('mode')).toBe('artist');
  });

  it('carries a second playlist in a friend link only when there is one', () => {
    expect(friendLink('https://x', 'one')).toBe('https://x/friends#a=one');
    expect(friendLink('https://x', 'one', 'two')).toBe('https://x/friends#a=one&b=two');
  });
});

describe('setup answers', () => {
  it('add only songs that aren’t saved already', () => {
    const saved = songSnapshot(killBill);
    const profile: MusicProfile = { ...emptyProfile, songs: [saved] };
    const other = { ...killBill, id: UUID(99), title: 'Another' };
    const merged = applyAnswers(profile, { name: '', genres: [], artists: [], songs: [killBill, other], discover: null });
    expect(merged.songs.map(s => s.title)).toEqual([killBill.title, 'Another']);
  });
});

describe('display helpers with little to show', () => {
  it('name an artist by what is known, down to “Artist”', () => {
    const bare = { ...phoebe, type: '', country: '', disambiguation: '' };
    expect(artistSubtitle({ ...bare, disambiguation: 'the singer' })).toBe('the singer');
    expect(artistSubtitle(bare)).toBe('Artist');
    expect(artistSubtitle({ ...(oliviaDetails as ArtistDetails), type: '', area: '', country: 'US' })).toBe('US');
  });

  it('say a song’s artist is unknown, and pick undated releases last', () => {
    expect(songArtists({ ...killBill, artists: [] })).toBe('Unknown artist');
    const song = { ...killBill, releases: [{ id: 'a', title: 'Undated', date: '' }, { id: 'b', title: 'Dated', date: '2020' }, { id: 'c', title: 'Also undated', date: '' }] };
    expect(firstRelease(song)!.title).toBe('Dated');
  });

  it('count studio albums on an incomplete list with none found so far', () => {
    const details = (count: number, complete: boolean) => ({ ...(oliviaDetails as ArtistDetails), discography: { ...(oliviaDetails as ArtistDetails).discography!, studioAlbumCount: count, complete } });
    expect(studioAlbumText(details(0, false))).toBe('0+ studio albums');
  });

  it('name roles and links they have no label for', () => {
    expect(roleText(['theremin'])).toBe('Theremin');
    expect(linkLabel({ type: 'bandcamp', url: 'https://unknown.example/x' })).toBe('Bandcamp');
  });
});

describe('search ranking with unusual results', () => {
  const profile = (genres: string[]): MusicProfile => ({ ...emptyProfile, genres });
  const artist = (id: string, name: string, tags?: string[]) => ({ ...phoebe, id, name, tags }) as Artist;

  it('leaves out placeholder artists, whatever they are tagged, and copes with none', () => {
    const special = artist(UUID(1), 'Some Placeholder', ['Special Purpose Artist']);
    const untagged = artist(UUID(2), 'Untagged');
    expect(rankSearchResults([special, untagged], 'untagged', profile([])).map(a => a.name)).toEqual(['Untagged']);
  });

  it('treats R&B and hip-hop spelled any way as the same genre', () => {
    const rnb = artist(UUID(3), 'Soul Singer', ['rhythm and blues']);
    const rap = artist(UUID(4), 'Rapper', ['hiphop']);
    const other = artist(UUID(5), 'Folk Singer', ['folk']);
    expect(rankSearchResults([other, rnb], 'singer', profile(['R&B']))[0].name).toBe('Soul Singer');
    expect(rankSearchResults([other, rap], 'r', profile(['Hip Hop']))[0].name).toBe('Rapper');
  });

  it('ranks a dataset song without a genre', () => {
    const song = { id: 'sp1', title: 'Song', artists: ['X'], album: null, genre: null, has_lyrics: true };
    expect(rankSearchResults([song], 'song', profile(['pop']))).toEqual([song]);
  });
});

describe('playlist files with odd shapes', () => {
  it('reads Windows line endings', () => {
    expect(readCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('refuses an empty CSV, and reads one without an artist column or with short rows', () => {
    expect(() => parsePlaylist('p.csv', '')).toThrow('The playlist file is empty.');
    expect(parsePlaylist('p.csv', 'Title\nvampire')).toEqual([{ title: 'vampire', artist: '' }]);
    expect(parsePlaylist('p.csv', 'Title,Artist\nvampire')).toEqual([{ title: 'vampire', artist: '' }]);
  });

  it('reads JSON tracks wrapped in a track object, with artists as objects or not a list', () => {
    const json = JSON.stringify({ items: [
      { track: { name: 'One', artists: [{ name: 'A' }, { name: 'B' }, {}] } },
      { title: 'Two', artists: 'not a list' },
      { title: 'Three', artists: ['C'] },
    ] });
    expect(parsePlaylist('p.json', json)).toEqual([
      { title: 'One', artist: 'A, B' },
      { title: 'Two', artist: '' },
      { title: 'Three', artist: 'C' },
    ]);
  });

  it('searches by the whole title when only a feature credit is left without it', () => {
    expect(matchQuery({ title: '(feat. Someone)', artist: '' })).toBe('recording:"(feat. Someone)"');
  });
});

describe('profiles from storage and links', () => {
  it('saves a song without an artist id as having none', () => {
    expect(songSnapshot({ ...killBill, artists: [] } as Song).artistId).toBeNull();
  });

  it('keeps at most 100 of each, reads junk entries as nothing, and checks albums too', () => {
    const artists = Array.from({ length: 101 }, (_, i) => ({ id: UUID(i), name: `A${i}` }));
    const albums = [{ id: UUID(1), title: 'Album', artist: 'X', artistId: 'bad', year: 20201, artUrl: 'https://evil.example/x.jpg' }, { id: 'bad', title: 'No' }, 'junk', null];
    const parsed = parseProfile({ artists: [...artists, 'junk'], songs: [], albums, genres: [] })!;
    expect(parsed.artists).toHaveLength(100);
    expect(parsed.albums).toEqual([{ id: UUID(1), title: 'Album', artist: 'X', artistId: null, year: '', artUrl: null }]);
  });
});

describe('stored playlists and taste maps', () => {
  it('ignore a stored playlist without a list of songs, or with nothing usable in it', () => {
    localStorage.setItem('song-nexus-playlist', JSON.stringify({ name: 'x' }));
    expect(readStoredPlaylist()).toBeNull();
    localStorage.setItem('song-nexus-playlist', JSON.stringify({ name: 'x', songs: [{ title: 'No artist' }, [7, 'A']] }));
    expect(readStoredPlaylist()).toBeNull();
    localStorage.setItem('song-nexus-playlist', JSON.stringify({ name: 7, songs: [['T', 'A']] }));
    expect(readStoredPlaylist()).toEqual({ name: '', songs: [{ title: 'T', artist: 'A' }] });
  });

  it('name what a node is linked to from either end, and skip links to nodes not on the map', () => {
    const node = (id: string) => ({ kind: 'artist', id, name: id.toUpperCase(), subtitle: '', mbid: null, imageUrl: null, group: 'mine', weight: 1, reasons: [] });
    const map = { nodes: [node('a'), node('b'), node('c')], links: [{ from: 'a', to: 'b', kind: 'similar' }, { from: 'c', to: 'a', kind: 'similar' }, { from: 'a', to: 'gone', kind: 'similar' }, { from: 'b', to: 'c', kind: 'similar' }], stats: {}, sources: [] };
    expect(tasteNear('a', map as never)).toEqual(['B', 'C']);
  });
});



describe('the last few cases', () => {
  it('says an artist with a complete list has no studio albums', () => {
    const details = { ...(oliviaDetails as ArtistDetails), discography: { ...(oliviaDetails as ArtistDetails).discography!, studioAlbumCount: 0, complete: true } };
    expect(studioAlbumText(details)).toBe('No studio albums listed');
  });

  it('skips blank lines, and rows too short to have a title', () => {
    expect(readCsv('a\n\nb')).toEqual([['a'], ['b']]);
    expect(parsePlaylist('p.csv', 'Artist,Title\nOnly artist\nX,Song')).toEqual([{ title: 'Song', artist: 'X' }]);
  });

  it('drops saved songs without an id or title', () => {
    expect(parseProfile({ artists: [], songs: [{ id: 'bad', title: 'T' }, { id: UUID(1) }], albums: [], genres: [] })!.songs).toEqual([]);
    expect(parseProfile({ artists: [], songs: [{ id: UUID(1), title: 'T' }], albums: [], genres: [] })!.songs[0].duration).toBe('—');
  });

  it('ignores a stored playlist that isn’t JSON', () => {
    localStorage.setItem('song-nexus-playlist', '{');
    expect(readStoredPlaylist()).toBeNull();
  });
});

describe('error messages', () => {
  it('use an error’s own words, and the fallback for anything else thrown', () => {
    expect(errorText(new Error('Offline.'), 'Search failed.')).toBe('Offline.');
    expect(errorText('a string', 'Search failed.')).toBe('Search failed.');
  });
});
