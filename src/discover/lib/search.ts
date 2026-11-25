// Finds artists, songs, labels and genres in the catalog by name.
import type { Catalog } from "./catalog";
import type { EntityKind, EntityRef } from "./types";
import { artistRef, songRef } from "./words";

/** The form names are compared in: lower case, no accents or punctuation, "&" as "and". */
export function normalize(text: string): string {
  return text
    .replace(/&/g, " and ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['‘’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

type Entry = {
  kind: EntityKind;
  at: number;
  names: { name: string; compact: string }[];
  weight: number;
};

const indexes = new WeakMap<Catalog, Entry[]>();

function indexOf(catalog: Catalog): Entry[] {
  const known = indexes.get(catalog);
  if (known) return known;
  const entry = (kind: EntityKind, at: number, names: string[], weight: number): Entry => ({
    kind,
    at,
    weight,
    names: [...new Set(names.map(normalize))]
      .filter(Boolean)
      .map((name) => ({ name, compact: name.replace(/ /g, "") })),
  });
  // Within equally good matches: artists with full pages and more listeners, then songs by them.
  const artistWeight = (at: number) =>
    Math.log1p(catalog.artists[at].listeners ?? 0) + 4 * catalog.artists[at].level;
  const entries = [
    ...catalog.artists.map((a, at) =>
      entry("artist", at, [a.name, ...a.aliases], 4 + artistWeight(at)),
    ),
    ...catalog.songs.map((s, at) =>
      entry("song", at, [s.title], Math.max(0, ...s.primary.map(artistWeight))),
    ),
    ...catalog.labels.map((l, at) =>
      entry("label", at, [l.name], Math.log1p(catalog.labelReleases[at].length)),
    ),
    ...catalog.genres.map((g, at) =>
      entry("genre", at, [g.name], 6 + Math.log1p(catalog.genreArtists[at].length)),
    ),
  ];
  indexes.set(catalog, entries);
  return entries;
}

const NO_MATCH = 99;

/** How well an entry matches, over all its names. An artist's other names count a little less. */
function tier(entry: Entry, query: string, compact: string): number {
  let best = NO_MATCH;
  entry.names.forEach(({ name, compact: joined }, i) => {
    const other = i === 0 ? 0 : 0.5;
    if (name === query || joined === compact || name === `the ${query}`)
      best = Math.min(best, other);
    else if (
      name.startsWith(query) ||
      joined.startsWith(compact) ||
      name.startsWith(`the ${query}`)
    )
      best = Math.min(best, 1 + other);
    else if (` ${name}`.includes(` ${query}`)) best = Math.min(best, 2 + other);
  });
  return best;
}

function refOf(catalog: Catalog, { kind, at }: Entry): EntityRef {
  switch (kind) {
    case "artist": {
      const { id, name, note, photo } = artistRef(catalog, at);
      return { kind, id, name, note, image: photo };
    }
    case "song":
      return songRef(catalog, at);
    case "label":
      return {
        kind,
        id: catalog.labels[at].id,
        name: catalog.labels[at].name,
        note: "Record label",
      };
    case "genre":
      return { kind, id: catalog.genres[at].slug, name: catalog.genres[at].name, note: "Genre" };
  }
}

/** Best matches first: whole names, then beginnings, then whole words inside a name. */
export function searchCatalog(
  catalog: Catalog,
  text: string,
  kinds: readonly EntityKind[],
  limit = 12,
): EntityRef[] {
  const query = normalize(text);
  if (!query) return [];
  const compact = query.replace(/ /g, "");
  return indexOf(catalog)
    .filter((e) => kinds.includes(e.kind))
    .map((e) => ({ e, t: tier(e, query, compact) }))
    .filter(({ t }) => t < NO_MATCH)
    .sort((x, y) => x.t - y.t || y.e.weight - x.e.weight || x.e.at - y.e.at)
    .slice(0, limit)
    .map(({ e }) => refOf(catalog, e));
}
