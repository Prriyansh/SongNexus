import { describe, expect, it } from 'vitest';
import type { Song } from '@/lib/types';
import { matchQuery, parsePlaylist, pickMatch, readCsv } from '../playlist';

const song = (title: string, ...artists: string[]): Song => ({
  id: `${title}-${artists.join()}`, title, durationMs: null, disambiguation: '', tags: [], releases: [],
  artists: artists.map(name => ({ name, id: null })),
});

describe('parsePlaylist', () => {
  it('reads CSV exports with quoted cells and a Track Name column', () => {
    const rows = parsePlaylist('list.csv', '﻿Track Name,Artist Name\n"Hello, Goodbye",The Beatles\n"Say ""Hi""",Me\n');
    expect(rows).toEqual([{ title: 'Hello, Goodbye', artist: 'The Beatles' }, { title: 'Say "Hi"', artist: 'Me' }]);
  });

  it('needs a title column in CSV and reports unclosed quotes', () => {
    expect(() => parsePlaylist('a.csv', 'Artist\nX')).toThrow(/Title or Track Name/);
    expect(() => readCsv('"open')).toThrow(/unclosed quote/);
  });

  it('reads JSON arrays, wrapped track lists and nested Spotify-style tracks', () => {
    expect(parsePlaylist('a.json', '["vampire — Olivia Rodrigo"]')).toEqual([{ title: 'vampire', artist: 'Olivia Rodrigo' }]);
    expect(parsePlaylist('a.json', JSON.stringify({ items: [{ track: { name: 'Kill Bill', artists: [{ name: 'SZA' }] } }] })))
      .toEqual([{ title: 'Kill Bill', artist: 'SZA' }]);
    expect(() => parsePlaylist('a.json', '{"x":1}')).toThrow(/track array/);
  });

  it('reads text files, skipping blanks and # comments', () => {
    expect(parsePlaylist('a.txt', '# mine\n\nAnti-Hero - Taylor Swift\nJust a title')).toEqual([
      { title: 'Anti-Hero', artist: 'Taylor Swift' }, { title: 'Just a title', artist: '' },
    ]);
  });

  it('rejects empty and oversized playlists', () => {
    expect(() => parsePlaylist('a.txt', '\n# nothing')).toThrow(/No track titles/);
    expect(() => parsePlaylist('a.txt', Array.from({ length: 251 }, (_, i) => `Song ${i}`).join('\n'))).toThrow(/250 tracks/);
  });
});

describe('matchQuery', () => {
  it('searches the title and the first credited artist', () => {
    expect(matchQuery({ title: 'Kill Bill', artist: 'SZA, Doja Cat' })).toBe('recording:"Kill Bill" AND artist:"SZA"');
    expect(matchQuery({ title: 'Kill Bill', artist: '' })).toBe('recording:"Kill Bill"');
  });

  it('drops "feat." credits from the title and escapes quotes', () => {
    expect(matchQuery({ title: 'Love Me (feat. X)', artist: '' })).toBe('recording:"Love Me"');
    expect(matchQuery({ title: 'Say "Hi"', artist: 'A\\B' })).toBe('recording:"Say \\"Hi\\"" AND artist:"A\\\\B"');
  });
});

describe('pickMatch', () => {
  const results = [song('Vampire Weekend'), song('vampire', 'Someone Else'), song('vampire', 'Olivia Rodrigo')];

  it('needs the exact title and a matching artist when the row has one', () => {
    expect(pickMatch({ title: 'Vampire', artist: 'Olivia Rodrigo' }, results)?.artists[0].name).toBe('Olivia Rodrigo');
    expect(pickMatch({ title: 'vampire', artist: 'Nobody' }, results)).toBeUndefined();
  });

  it('takes the first exact title when the row has no artist', () => {
    expect(pickMatch({ title: 'vampire', artist: '' }, results)?.artists[0].name).toBe('Someone Else');
  });

  it('ignores case, accents, feat. credits and remaster suffixes', () => {
    expect(pickMatch({ title: 'Jolene - Remastered 2011', artist: 'dolly parton' }, [song('Jolène', 'Dolly Parton')])).toBeDefined();
    expect(pickMatch({ title: 'Kill Bill (feat. Doja Cat)', artist: 'SZA & Doja Cat' }, [song('Kill Bill', 'SZA')])).toBeDefined();
  });
});
