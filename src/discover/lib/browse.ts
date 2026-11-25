// Ways into the catalog: well-known artists, big genres and labels, and pairs worth trying.
import type { Catalog } from "./catalog";
import type { Graph } from "./graph";
import { findPath } from "./paths";
import { DEFAULT_CATEGORIES, type ArtistRef, type EntityRef } from "./types";
import { artistRef } from "./words";

const FULL_PAGE = 2;

/** Artists with full pages, most listened to first (listeners are ListenBrainz's). */
function knownArtists(catalog: Catalog): number[] {
  return catalog.artists
    .map((_, at) => at)
    .filter((at) => catalog.artists[at].level === FULL_PAGE)
    .sort((x, y) => (catalog.artists[y].listeners ?? 0) - (catalog.artists[x].listeners ?? 0) || x - y);
}

export function popularArtists(catalog: Catalog, limit: number): ArtistRef[] {
  return knownArtists(catalog).slice(0, limit).map((at) => artistRef(catalog, at));
}

export function biggestGenres(catalog: Catalog, limit: number): EntityRef[] {
  return catalog.genres
    .map((genre, at) => ({ genre, size: catalog.genreArtists[at].length }))
    .sort((x, y) => y.size - x.size || x.genre.name.localeCompare(y.genre.name))
    .slice(0, limit)
    .map(({ genre }) => ({ kind: "genre", id: genre.slug, name: genre.name, note: "" }));
}

export function biggestLabels(catalog: Catalog, limit: number): EntityRef[] {
  return catalog.labels
    .map((label, at) => ({ label, size: catalog.labelReleases[at].length }))
    .filter(({ label }) => !label.name.startsWith("["))
    .sort((x, y) => y.size - x.size || x.label.name.localeCompare(y.label.name))
    .slice(0, limit)
    .map(({ label }) => ({ kind: "label", id: label.id, name: label.name, note: "" }));
}

const MAIN_GENRE_SHARE = 15;

type Pair = { from: ArtistRef; to: ArtistRef };

const pairsOf = new WeakMap<Graph, Pair[]>();

/** Connected pairs of well-known artists who share no main genre, so the path says something. */
export function surprisePairs(graph: Graph, count = 24): Pair[] {
  const ready = pairsOf.get(graph);
  if (ready) return ready;
  const catalog = graph.catalog;
  const known = knownArtists(catalog).slice(0, 120);
  const mainGenres = (at: number) => catalog.artists[at].genres.filter((g) => g.share >= MAIN_GENRE_SHARE).map((g) => g.genre);
  const pairs: Pair[] = [];
  for (let i = 0; i < known.length && pairs.length < count; i++) {
    const from = known[i];
    const own = new Set(mainGenres(from));
    // Start each search somewhere else in the list, so the same few artists don't fill every pair.
    for (let step = 0; step < known.length; step++) {
      const to = known[(i * 37 + 53 + step) % known.length];
      if (to === from || !own.size || !mainGenres(to).length || mainGenres(to).some((g) => own.has(g))) continue;
      if (!findPath(graph, from, to, { categories: DEFAULT_CATEGORIES })) continue;
      pairs.push({ from: artistRef(catalog, from), to: artistRef(catalog, to) });
      break;
    }
  }
  pairsOf.set(graph, pairs);
  return pairs;
}
