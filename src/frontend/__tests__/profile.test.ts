// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { albumSnapshot, artistSnapshot, emptyProfile, parseProfile, readStoredProfile, songSnapshot, storeProfile } from '../profile';
import { killBill, phoebe, phoebeDetails, PHOEBE, PUNISHER } from './fixtures';

describe('snapshots', () => {
  it('keeps what About Me needs from an artist search result', () => {
    expect(artistSnapshot(phoebe)).toEqual({ id: PHOEBE, name: 'Phoebe Bridgers', subtitle: 'Person · US' });
  });

  it('uses the earliest release of a song for album, year and cover art', () => {
    expect(songSnapshot(killBill)).toEqual({
      id: killBill.id, title: 'Kill Bill', artist: 'SZA', artistId: killBill.artists[0].id, album: 'SOS', year: '2022',
      duration: '2:33', artUrl: 'https://coverartarchive.org/release/cc000000-0000-4000-8000-000000000009/front-250',
    });
    expect(songSnapshot({ ...killBill, durationMs: null, releases: [] })).toMatchObject({ duration: '—', album: '', artUrl: null });
  });

  it('turns a discography album into a saved album', () => {
    const punisher = phoebeDetails.discography!.representative[1];
    expect(albumSnapshot(punisher, phoebe)).toMatchObject({ id: PUNISHER, title: 'Punisher', artist: 'Phoebe Bridgers', artistId: PHOEBE, year: '2020' });
  });
});

describe('parseProfile', () => {
  const valid = { artists: [artistSnapshot(phoebe)], songs: [songSnapshot(killBill)], albums: [], genres: ['indie folk'] };

  it('accepts a valid profile unchanged', () => {
    expect(parseProfile(valid)).toEqual(valid);
  });

  it('rejects anything that is not a profile', () => {
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile('x')).toBeNull();
    expect(parseProfile({ artists: [] })).toBeNull();
  });

  it('drops items with bad ids or names, and duplicates', () => {
    const parsed = parseProfile({ ...valid, artists: [artistSnapshot(phoebe), artistSnapshot(phoebe), { id: 'nope', name: 'X' }, { id: PHOEBE.replace('0f', '1f') }] });
    expect(parsed!.artists.map(a => a.name)).toEqual(['Phoebe Bridgers']);
  });

  it('only keeps Cover Art Archive images, so a shared link cannot load arbitrary URLs', () => {
    const song = { ...songSnapshot(killBill), artUrl: 'https://tracker.example/pixel.gif' };
    expect(parseProfile({ ...valid, songs: [song] })!.songs[0].artUrl).toBeNull();
  });

  it('caps list sizes and string lengths', () => {
    const genres = Array.from({ length: 150 }, (_, i) => `genre ${i}`);
    const parsed = parseProfile({ ...valid, genres, artists: [{ ...artistSnapshot(phoebe), name: 'x'.repeat(500) }] })!;
    expect(parsed.genres).toHaveLength(100);
    expect(parsed.artists[0].name).toHaveLength(200);
  });
});

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and round-trips through localStorage', () => {
    expect(readStoredProfile()).toEqual(emptyProfile);
    const profile = { ...emptyProfile, genres: ['pop'] };
    storeProfile(profile);
    expect(readStoredProfile()).toEqual(profile);
  });

  it('recovers from corrupt storage', () => {
    localStorage.setItem('song-nexus-profile', '{oops');
    expect(readStoredProfile()).toEqual(emptyProfile);
  });
});
