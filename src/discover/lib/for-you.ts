// For you: artists to try, from the favourites saved in About Me. Each pick says why: the favourite
// it is most closely connected to and the credit behind it, or the favourite genre it is known for.
// Server only.
import type { Catalog } from "./catalog";
import { evidenceBetween, neighbors, type Graph } from "./graph";
import { normalize } from "./search";
import { DEFAULT_CATEGORIES, type EntityRef, type ForYouPick } from "./types";
import { artistRef, reasonOf } from "./words";

export const MAX_SEEDS = 50;
export const MAX_GENRES = 20;
export const PICKS = 18;
/** Picks from credits come first; genres fill the rest. */
export const FROM_CREDITS = 12;
/** How many of each favourite's closest connections are considered. */
export const PER_SEED = 40;

/** Genres by MusicBrainz name (About Me's form) or slug, compared without case or accents. */
export function genreIndex(c: Catalog): Map<string, number> {
  const index = new Map<string, number>();
  c.genres.forEach((genre, at) => {
    index.set(normalize(genre.name), at);
    index.set(normalize(genre.slug), at);
  });
  return index;
}

const genreRef = (c: Catalog, at: number): EntityRef => ({
  kind: "genre",
  id: c.genres[at].slug,
  name: c.genres[at].name,
  note: "Genre",
});

/**
 * Artists connected to many favourites come first, each favourite's connections counted relative
 * to its closest one, so a favourite with hundreds of credits doesn't drown out the rest. Only
 * artists people listen to (with ListenBrainz listeners) are picked.
 */
export function forYou(
  g: Graph,
  seeds: readonly number[],
  genres: readonly number[],
  hidden: ReadonlySet<number> = new Set(),
): ForYouPick[] {
  const c = g.catalog;
  const taken = new Set([...seeds, ...hidden]);
  const listened = (at: number) => c.artists[at].listeners !== null;
  const scores = new Map<number, { total: number; best: number; strength: number }>();
  for (const seed of seeds) {
    const near = neighbors(g, seed, DEFAULT_CATEGORIES)
      .filter((n) => !taken.has(n.artist) && listened(n.artist))
      .slice(0, PER_SEED);
    for (const n of near) {
      const score = scores.get(n.artist) ?? { total: 0, best: seed, strength: 0 };
      score.total += n.strength / near[0].strength;
      if (n.strength > score.strength) Object.assign(score, { best: seed, strength: n.strength });
      scores.set(n.artist, score);
    }
  }
  const picks: ForYouPick[] = [...scores]
    .sort(([x, p], [y, q]) => q.total - p.total || x - y)
    .slice(0, FROM_CREDITS)
    .map(([artist, { best }]) => {
      taken.add(artist);
      return {
        artist: artistRef(c, artist),
        because: artistRef(c, best),
        reason: reasonOf(c, evidenceBetween(c, best, artist, DEFAULT_CATEGORIES)[0]),
        genre: null,
      };
    });
  // Then the best-known artists of each favourite genre, in turn.
  const queues = genres.map((genre) =>
    c.genreArtists[genre]
      .filter(listened)
      .sort((x, y) => c.artists[y].listeners! - c.artists[x].listeners! || x - y)
      .map((artist) => ({ artist, genre })),
  );
  while (picks.length < PICKS && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      let next = queue.shift();
      while (next && taken.has(next.artist)) next = queue.shift();
      if (!next || picks.length === PICKS) continue;
      taken.add(next.artist);
      picks.push({ artist: artistRef(c, next.artist), because: null, reason: null, genre: genreRef(c, next.genre) });
    }
  }
  return picks;
}
