import { describe, expect, it } from 'vitest';
import type { Artist, Song } from '@/lib/types';
import type { SoundTrackBrief } from '@/lib/sound';
import { emptyProfile } from '../profile';
import type { MusicProfile, SavedAlbum, SavedSong } from '../profile';
import { rankSearchResults } from '../search-ranking';

const artist = (id: string, name: string, tags: string[] = []): Artist => ({ id, name, tags, disambiguation: '', country: '', type: '', lifeSpan: {} });
const song = (id: string, title: string, artistId: string | null, artistName: string): Song => ({ id, title, artists: [{ id: artistId, name: artistName }], tags: [], releases: [], durationMs: null, disambiguation: '' });
const datasetSong = (id: string, title: string, name: string, genre: string | null = null): SoundTrackBrief => ({ id, title, artists: [name], genre, album: null, has_lyrics: false });
const profile = (value: Partial<MusicProfile>): MusicProfile => ({ ...emptyProfile, ...value });
const favorite = (id: string, name: string) => ({ id, name, subtitle: '', artUrl: null });
const savedSong = (id: string, title: string, artistId: string | null, artistName: string): SavedSong => ({ id, title, artistId, artist: artistName, album: '', year: '', duration: '', artUrl: null });
const savedAlbum = (id: string, artistId: string | null, artistName: string): SavedAlbum => ({ id, title: 'Favorite album', artistId, artist: artistName, year: '', artUrl: null });
const ids = (items: { id: string }[]) => items.map(item => item.id);

describe('search ranking', () => {
  it('keeps provider popularity/relevance order for tied matches without preferences, without mutating input', () => {
    const items = Object.freeze([artist('popular', 'Echo'), artist('next', 'Echo'), artist('last', 'Echo')]);
    const result = rankSearchResults(items, 'echo', emptyProfile);
    expect(ids(result)).toEqual(['popular', 'next', 'last']);
    expect(result).not.toBe(items);
    expect(result[0]).toBe(items[0]);
    expect(ids([...items])).toEqual(['popular', 'next', 'last']);
  });

  it('ranks normalized exact names before prefixes, full-token matches and substrings', () => {
    const items = [artist('substring', 'Echolalia'), artist('token', 'The Echo'), artist('prefix', 'Echo Park'), artist('exact', 'Écho!')];
    expect(ids(rankSearchResults(items, 'ECHO', emptyProfile))).toEqual(['exact', 'prefix', 'token', 'substring']);
    expect(ids(rankSearchResults([artist('long', 'AC/DC Live'), artist('exact', 'AC/DC')], 'acdc', emptyProfile))[0]).toBe('exact');
  });

  it('uses complete query words rather than unrelated substrings for token matching', () => {
    expect(ids(rankSearchResults([artist('substring', 'Red Lovebird'), artist('tokens', 'Red and Love')], 'love red', emptyProfile))).toEqual(['tokens', 'substring']);
  });

  it('retains provider fuzzy matches and their stable order when local text has no match', () => {
    const items = [artist('first', 'Pink'), artist('second', 'P!nk')];
    expect(ids(rankSearchResults(items, 'pnik', emptyProfile))).toEqual(['first', 'second']);
    expect(rankSearchResults([], 'anything', emptyProfile)).toEqual([]);
  });

  it('places artists from saved genres first without inferring tags that were not returned', () => {
    const items = [artist('exact', 'Harbor'), artist('genre', 'Harbor Band', ['indie-rock']), artist('missing', 'Harbor Folk')];
    expect(ids(rankSearchResults(items, 'harbor', profile({ genres: ['Róck'] })))).toEqual(['genre', 'exact', 'missing']);
  });

  it('recognizes clear child genres but does not match arbitrary substrings or sibling genres', () => {
    const items = [artist('popular', 'Artist'), artist('substring', 'Artist', ['popular']), artist('child', 'Artist', ['electropop'])];
    expect(ids(rankSearchResults(items, 'artist', profile({ genres: ['pop'] })))).toEqual(['child', 'popular', 'substring']);
    const related = [artist('country', 'Artist', ['country']), artist('folk', 'Artist', ['indie folk']), artist('rock', 'Artist', ['indie rock'])];
    expect(ids(rankSearchResults(related, 'artist', profile({ genres: ['indie rock'] })))).toEqual(['rock', 'country', 'folk']);
    const hipHop = [artist('popular', 'Artist'), artist('trap', 'Artist', ['trap']), artist('drill', 'Artist', ['drill']), artist('jazz', 'Artist', ['jazz'])];
    expect(ids(rankSearchResults(hipHop, 'artist', profile({ genres: ['hip-hop'] })))).toEqual(['trap', 'drill', 'popular', 'jazz']);
  });

  it('uses favorite artist IDs for songs and rejects a known different artist with the same name', () => {
    const items = [song('wrong', 'Echo', 'different-id', 'Favorite'), song('favorite', 'Echo live', 'favorite-id', 'Favorite')];
    const taste = profile({ artists: [favorite('favorite-id', 'Favorite')] });
    expect(ids(rankSearchResults(items, 'echo', taste))).toEqual(['favorite', 'wrong']);
    expect(ids(rankSearchResults([artist('different-id', 'Favorite'), artist('source-first', 'Favorite')], 'favorite', taste))).toEqual(['different-id', 'source-first']);
  });

  it('falls back to normalized names when credits or saved entries have no artist ID', () => {
    const items = [song('ordinary', 'Echo', 'other-id', 'Other'), song('missing-id', 'Echo', null, 'Beyoncé')];
    expect(ids(rankSearchResults(items, 'echo', profile({ artists: [favorite('favorite-id', 'Beyonce')] })))).toEqual(['missing-id', 'ordinary']);
    const saved = profile({ albums: [savedAlbum('album', null, 'Beyoncé')] });
    expect(ids(rankSearchResults([artist('ordinary', 'Other'), artist('beyonce', 'Beyonce')], '', saved))).toEqual(['beyonce', 'ordinary']);
  });

  it('learns favorite artists from saved songs and albums', () => {
    const taste = profile({ songs: [savedSong('saved-song', 'Old song', 'song-artist', 'Singer')], albums: [savedAlbum('saved-album', 'album-artist', 'Band')] });
    const items = [song('ordinary', 'Echo', 'other', 'Other'), song('album', 'Echo', 'album-artist', 'Band'), song('song', 'Echo', 'song-artist', 'Singer')];
    expect(ids(rankSearchResults(items, 'echo', taste))).toEqual(['album', 'song', 'ordinary']);
  });

  it('can prioritize an explicitly favorite album artist over a genre-only artist', () => {
    const taste = profile({ artists: [favorite('favorite', 'Harbor Band')], genres: ['rock'] });
    const items = [artist('genre', 'Harbor', ['rock']), artist('favorite', 'Harbor Band')];
    expect(ids(rankSearchResults(items, 'harbor', taste))).toEqual(['genre', 'favorite']);
    expect(ids(rankSearchResults(items, 'harbor', taste, { preferArtists: true }))).toEqual(['favorite', 'genre']);
  });

  it('boosts directly saved recordings while keeping distinct recording IDs', () => {
    const items = [song('new-id', 'Echo', 'favorite-id', 'Singer'), song('saved-id', 'Echo', 'favorite-id', 'Singer')];
    const taste = profile({ songs: [savedSong('saved-id', 'Echo', 'favorite-id', 'Singer')] });
    expect(ids(rankSearchResults(items, 'echo', taste))).toEqual(['saved-id', 'new-id']);
  });

  it('ranks dataset songs by favorite artist names, then relevance, then provider popularity', () => {
    const taste = profile({ artists: [favorite('favorite-id', 'Beyoncé')] });
    const items = [datasetSong('popular', 'Echo', 'Other'), datasetSong('favorite-live', 'Echo live', 'Beyonce'), datasetSong('favorite', 'Echo', 'Beyoncé')];
    expect(ids(rankSearchResults(items, 'echo', taste))).toEqual(['favorite', 'favorite-live', 'popular']);
  });

  it('recognizes a saved collaboration across dataset and MusicBrainz credit formats', () => {
    const taste = profile({ songs: [savedSong('mb-saved', 'Echo', 'lead-artist', 'Tyler, the Creator, Guest Artist')] });
    const collaboration = { ...datasetSong('sp-saved', 'Echo', 'Tyler, the Creator'), artists: ['Tyler, the Creator', 'Guest Artist'] };
    const items = [datasetSong('cover', 'Echo', 'Cover Artist'), collaboration];
    expect(ids(rankSearchResults(items, 'echo', taste))).toEqual(['sp-saved', 'cover']);
  });

  it('recognizes dataset song genres and combined title/artist or album queries', () => {
    const album = { ...datasetSong('album', 'Different title', 'Other'), album: 'Blue Moon' };
    const byArtist = datasetSong('artist', 'Blue', 'Moon');
    const unrelated = datasetSong('unrelated', 'Fuzzy title', 'Other');
    expect(ids(rankSearchResults([unrelated, byArtist, album], 'blue moon', emptyProfile))).toEqual(['album', 'artist', 'unrelated']);
    const items = [datasetSong('other', 'Echo', 'Other'), datasetSong('genre', 'Echo', 'Singer', 'r-n-b')];
    expect(ids(rankSearchResults(items, 'echo', profile({ genres: ['r&b'] })))).toEqual(['genre', 'other']);
  });

  it('removes invalid rows, special-purpose artists and duplicate IDs while retaining the first valid result', () => {
    const original = artist('same', 'Actual artist');
    const items = [artist('', 'No ID'), artist('blank', '  '), artist('unknown', '[unknown]'), artist('none', '[no artist]'), artist('various', 'Various Artists'), artist('special', 'Placeholder', ['Special-purpose artist']), original, artist('same', 'Duplicate'), artist('other', 'Actual artist')];
    const result = rankSearchResults(items, 'artist', emptyProfile);
    expect(ids(result)).toEqual(['same', 'other']);
    expect(result[0]).toBe(original);
  });
});
