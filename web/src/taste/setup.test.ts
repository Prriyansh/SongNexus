import {describe, expect, it} from 'vitest';

import {EMPTY_SETUP, nextStop, parseSetup} from './setup';

describe('first-visit setup answers', () => {
  it('keeps valid answers and drops anything unexpected', () => {
    const setup = parseSetup({
      name: '  Ana  ',
      discover: 'friends',
      songs: [
        {name: 'recordings/r1', title: 'Hit', artist: 'Zed'},
        {name: 'recordings/r1', title: 'Hit', artist: 'Zed'},
        {name: 'artists/a1', title: 'Not a song', artist: 'X'},
        {name: 'recordings/r2', title: '', artist: 'Y'},
      ],
    });
    expect(setup).toEqual({
      name: 'Ana',
      discover: 'friends',
      songs: [{name: 'recordings/r1', title: 'Hit', artist: 'Zed'}],
    });
    expect(parseSetup('nonsense')).toEqual(EMPTY_SETUP);
    expect(parseSetup({discover: 'elsewhere'}).discover).toBeNull();
  });

  it('leads each answer somewhere', () => {
    expect(nextStop('similar')).toBe('/map?mode=playlist');
    expect(nextStop('friends')).toBe('/map?mode=friend');
    expect(nextStop('new')).toBe('/');
    expect(nextStop(null)).toBe('/');
  });
});
