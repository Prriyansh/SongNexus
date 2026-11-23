import {afterEach, describe, expect, it} from 'vitest';

import {
  EMPTY,
  MAX_ARTISTS,
  clearPicks,
  parsePicks,
  readPicks,
  savePicks,
} from './picks';

const artist = (n: number) => ({
  name: `artists/a${n}`,
  displayName: `Artist ${n}`,
  imageUrl: null,
});

describe('picks', () => {
  afterEach(() => clearPicks());

  it('keeps only well-formed genres and artists, once each', () => {
    const picks = parsePicks({
      genres: [
        {name: 'genres/pop', displayName: 'pop'},
        {name: 'genres/pop', displayName: 'pop'},
        {name: 'not-a-genre', displayName: 'x'},
      ],
      artists: [
        {
          name: 'artists/a1',
          displayName: 'One',
          imageUrl: 'javascript:alert(1)',
        },
        {name: 'users/u1', displayName: 'Nope'},
        {name: 'artists/a2', displayName: '   '},
      ],
      done: 'yes',
    });
    expect(picks.genres).toEqual([{name: 'genres/pop', displayName: 'pop'}]);
    // Only https images are kept; anything else is dropped, not loaded.
    expect(picks.artists).toEqual([
      {name: 'artists/a1', displayName: 'One', imageUrl: null},
    ]);
    expect(picks.done).toBe(false);
  });

  it('caps how many artists are kept', () => {
    const many = Array.from({length: MAX_ARTISTS + 5}, (_, i) => artist(i));
    expect(parsePicks({artists: many}).artists).toHaveLength(MAX_ARTISTS);
  });

  it('round-trips through storage and survives garbage', () => {
    expect(readPicks()).toEqual(EMPTY);
    savePicks({genres: [], artists: [artist(1)], done: true});
    expect(readPicks()).toEqual({genres: [], artists: [artist(1)], done: true});
    localStorage.setItem('songnexus.picks.v1', '{not json');
    expect(readPicks()).toEqual(EMPTY);
  });
});
