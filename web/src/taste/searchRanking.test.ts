import {describe, expect, it} from 'vitest';

import type {Schemas} from '../api/client';

import {preferenceOf, rankByTaste} from './searchRanking';

function result(
  name: string,
  subtitle: string,
  matchType = 'prefix',
  entityType: Schemas['EntityType'] = 'RECORDING',
): Schemas['SearchResult'] {
  return {
    name,
    displayName: name,
    subtitle,
    matchType,
    matchedOn: name,
    entityType,
    imageUrl: null,
    blocked: false,
  };
}

const picks = {
  artists: [{name: 'artists/sza', displayName: 'SZA', imageUrl: null}],
  genres: [{name: 'genres/rnb', displayName: 'R&B'}],
};
const songs = [{name: 'recordings/saved', title: 'Saved', artist: 'Zed'}];

describe('search ranked by your saved music', () => {
  it('scores saved music, loved artists and liked genres', () => {
    expect(preferenceOf(result('recordings/saved', 'Zed'), picks, songs)).toBe(
      2,
    );
    expect(
      preferenceOf(result('artists/sza', '', 'prefix', 'ARTIST'), picks, songs),
    ).toBe(2);
    expect(preferenceOf(result('recordings/x', 'SZA'), picks, songs)).toBe(1);
    expect(
      preferenceOf(
        result('artists/y', 'US · r&b', 'prefix', 'ARTIST'),
        picks,
        songs,
      ),
    ).toBe(1);
    expect(preferenceOf(result('recordings/z', 'Somebody'), picks, songs)).toBe(
      0,
    );
  });

  it('moves preferred results up within the same match quality only', () => {
    const ranked = rankByTaste(
      [
        result('recordings/exact', 'Nobody', 'exact'),
        result('recordings/other', 'Nobody'),
        result('recordings/by-sza', 'SZA'),
        result('recordings/saved', 'Zed', 'fuzzy'),
      ],
      picks,
      songs,
    );
    expect(ranked.map(r => r.name)).toEqual([
      'recordings/exact',
      'recordings/by-sza',
      'recordings/other',
      'recordings/saved',
    ]);
  });

  it('keeps the server order with nothing saved', () => {
    const list = [result('a', ''), result('b', '')];
    expect(rankByTaste(list, {artists: [], genres: []}, [])).toEqual(list);
  });
});
