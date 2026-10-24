import { describe, expect, it } from 'vitest';
import { artistSubtitle, capitalize, colorFor, coverForRelease, firstRelease, lifeSpanLabels, linkLabel, recentAlbums, roleText, studioAlbumText, uniqueLinks } from '../model';
import { allGenres, familyOf, genreFamilies } from '../genres';
import { killBill, oliviaDetails, phoebe, taylorDetails } from './fixtures';

describe('lifeSpanLabels', () => {
  // MusicBrainz's life-span.begin is a birth date for people, not when a career began.
  it('labels people, groups and everything else differently', () => {
    expect(lifeSpanLabels('Person')).toEqual({ begin: 'Born', end: 'Died' });
    expect(lifeSpanLabels('Group')).toEqual({ begin: 'Formed', end: 'Disbanded' });
    expect(lifeSpanLabels('')).toEqual({ begin: 'Began', end: 'Ended' });
  });
});

describe('studioAlbumText', () => {
  it('shows exact counts, and a lower bound when the album browse was partial', () => {
    expect(studioAlbumText(taylorDetails)).toBe('18 studio albums');
    expect(studioAlbumText({ ...taylorDetails, discography: { ...taylorDetails.discography!, studioAlbumCount: 12, complete: false } })).toBe('12+ studio albums');
    expect(studioAlbumText({ ...taylorDetails, discography: { ...taylorDetails.discography!, studioAlbumCount: 1 } })).toBe('1 studio album');
    expect(studioAlbumText({ ...taylorDetails, discography: null })).toBe('Not available');
  });
});

describe('links', () => {
  it('names services by host and keeps one link per service', () => {
    expect(oliviaDetails.links.map(linkLabel)).toEqual(['Apple Music', 'Apple Music', 'Spotify']);
    expect(uniqueLinks(oliviaDetails.links).map(linkLabel)).toEqual(['Apple Music', 'Spotify']);
    expect(linkLabel({ type: 'official homepage', url: 'https://example.com' })).toBe('Official site');
  });
});

describe('small helpers', () => {
  it('gives each id a stable colour', () => {
    expect(colorFor('abc')).toBe(colorFor('abc'));
    expect(colorFor('abc')).toMatch(/^hsl\(\d+ 30% 42%\)$/);
  });

  it('formats artists, roles and genres for display', () => {
    expect(artistSubtitle(phoebe)).toBe('Person · US');
    expect(artistSubtitle(oliviaDetails)).toBe('Person · United States');
    expect(roleText(['featured', 'mixing'])).toBe('Featured artist, Mixing');
    expect(capitalize('synth-pop rock')).toBe('Synth-Pop Rock');
  });

  it('picks the earliest release and builds cover art URLs only for real ids', () => {
    expect(firstRelease(killBill)?.title).toBe('SOS');
    expect(coverForRelease('../../etc')).toBeNull();
    expect(coverForRelease(killBill.releases[0].id)).toContain('coverartarchive.org/release/');
  });

  it('orders albums newest first without changing the original', () => {
    const albums = oliviaDetails.discography!.representative;
    expect(recentAlbums(albums).map(a => a.title)).toEqual(['GUTS', 'SOUR']);
    expect(albums[0].title).toBe('SOUR');
  });
});

describe('genres', () => {
  it('lists unique MusicBrainz-style genre names, each in one family', () => {
    expect(new Set(allGenres).size).toBe(allGenres.length);
    expect(allGenres.every(g => g === g.toLowerCase())).toBe(true);
    expect(familyOf('Indie Folk')).toBe('Folk / Country');
    expect(familyOf('polka')).toBe('Genre');
    expect(Object.keys(genreFamilies).length).toBeGreaterThan(5);
  });
});
