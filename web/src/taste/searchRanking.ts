/**
 * Search ranked by your saved music (Helen's search ranking from the team app). Among results
 * that match equally well, your saved songs and artists come first, then songs by artists you
 * love and results in your genres, then the server's order. A weaker match never jumps an
 * exact one: what you typed still decides first.
 */
import type {Schemas} from '../api/client';

import type {Picks} from './picks';
import type {SavedSong} from './setup';

type Result = Schemas['SearchResult'];

const TIER: Record<string, number> = {
  exact: 0,
  prefix: 1,
  token_prefix: 2,
  eponymous: 2,
  fuzzy: 3,
};

const key = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** 2: saved song or artist; 1: by an artist you love, or in a genre you like; 0: neither. */
export function preferenceOf(
  result: Result,
  picks: Pick<Picks, 'artists' | 'genres'>,
  songs: readonly SavedSong[],
): number {
  if (songs.some(s => s.name === result.name)) return 2;
  if (picks.artists.some(a => a.name === result.name)) return 2;
  const subtitle = ` ${key(result.subtitle)} `;
  const byLoved = picks.artists.some(a => {
    const name = key(a.displayName);
    return name !== '' && subtitle.includes(` ${name} `);
  });
  if (result.entityType !== 'ARTIST' && byLoved) return 1;
  const inGenre = picks.genres.some(g => {
    const genre = key(g.displayName);
    return genre !== '' && subtitle.includes(` ${genre} `);
  });
  return inGenre ? 1 : 0;
}

export function rankByTaste(
  results: readonly Result[],
  picks: Pick<Picks, 'artists' | 'genres'>,
  songs: readonly SavedSong[],
): Result[] {
  if (!picks.artists.length && !picks.genres.length && !songs.length)
    return [...results];
  return results
    .map((result, index) => ({
      result,
      index,
      tier: TIER[result.matchType] ?? 3,
      preference: preferenceOf(result, picks, songs),
    }))
    .sort(
      (a, b) =>
        a.tier - b.tier || b.preference - a.preference || a.index - b.index,
    )
    .map(r => r.result);
}
