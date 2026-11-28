// How a set of artists hangs together: which of them worked together, and the people between them;
// and for two people's artists, the shortest paths from one person's to the other's. Server only.
import { evidenceBetween, neighbors, strengthOf, type Graph } from "./graph";
import { findPath } from "./paths";
import { DEFAULT_CATEGORIES, type ArtistRef, type Reason } from "./types";
import { artistRef, reasonOf } from "./words";

export const MAX_ARTISTS = 25;
/** Friend paths compare this many artists from each side. */
export const MAX_SIDE = 5;
export const SHOWN = 8;

export type Link = { a: ArtistRef; b: ArtistRef; reason: Reason };
export type Between = { artist: ArtistRef; with: ArtistRef[] };
export type Nexus = { artists: ArtistRef[]; linked: Link[]; between: Between[] };

const reasonBetween = (g: Graph, a: number, b: number) =>
  reasonOf(g.catalog, evidenceBetween(g.catalog, a, b, DEFAULT_CATEGORIES)[0]);

/** People outside `inside` connected to the most of the sides' artists, and to every side. */
function between(g: Graph, sides: number[][], inside: Set<number>): Between[] {
  const reached = new Map<number, Set<number>[]>();
  sides.forEach((side, s) => {
    for (const artist of side)
      for (const n of neighbors(g, artist, DEFAULT_CATEGORIES)) {
        if (inside.has(n.artist)) continue;
        const own = reached.get(n.artist) ?? sides.map(() => new Set<number>());
        own[s].add(artist);
        reached.set(n.artist, own);
      }
  });
  return [...reached]
    .map(([artist, by]) => ({ artist, by, total: by.reduce((sum, set) => sum + set.size, 0) }))
    .filter(({ by, total }) => by.every((set) => set.size > 0) && total >= 2)
    .sort((x, y) => y.total - x.total || x.artist - y.artist)
    .slice(0, SHOWN)
    .map(({ artist, by }) => ({
      artist: artistRef(g.catalog, artist),
      with: by.flatMap((set) => [...set]).map((a) => artistRef(g.catalog, a)),
    }));
}

/** Which of these artists worked together, and who is connected to several of them. */
export function nexusOf(g: Graph, artists: readonly number[]): Nexus {
  const linked: (Link & { strength: number })[] = [];
  artists.forEach((a, i) => {
    for (const b of artists.slice(i + 1)) {
      const edge = g.edges[a].get(b);
      const strength = edge ? strengthOf(edge, DEFAULT_CATEGORIES) : 0;
      if (strength > 0)
        linked.push({ a: artistRef(g.catalog, a), b: artistRef(g.catalog, b), reason: reasonBetween(g, a, b), strength });
    }
  });
  return {
    artists: artists.map((a) => artistRef(g.catalog, a)),
    linked: linked
      .sort((x, y) => y.strength - x.strength)
      .slice(0, SHOWN * 2)
      .map(({ a, b, reason }) => ({ a, b, reason })),
    between: between(g, [[...artists]], new Set(artists)),
  };
}

export type FriendPath = { artists: ArtistRef[]; reasons: Reason[] };
export type FriendPaths = { shared: ArtistRef[]; paths: FriendPath[]; between: Between[] };

/** Artists both like, the shortest paths from one side's artists to the other's, and who links them. */
export function friendPathsOf(g: Graph, mine: readonly number[], theirs: readonly number[]): FriendPaths {
  const own = new Set(mine);
  const shared = theirs.filter((a) => own.has(a));
  const left = mine.filter((a) => !shared.includes(a));
  const right = theirs.filter((a) => !shared.includes(a));
  const paths: number[][] = [];
  for (const a of left)
    for (const b of right) {
      const path = findPath(g, a, b, { categories: DEFAULT_CATEGORIES });
      if (path) paths.push(path);
    }
  paths.sort((x, y) => x.length - y.length || x[0] - y[0] || x[x.length - 1] - y[y.length - 1]);
  return {
    shared: shared.map((a) => artistRef(g.catalog, a)),
    paths: paths.slice(0, SHOWN).map((path) => ({
      artists: path.map((a) => artistRef(g.catalog, a)),
      reasons: path.slice(1).map((b, i) => reasonBetween(g, path[i], b)),
    })),
    between: left.length && right.length ? between(g, [left, right], new Set([...mine, ...theirs])) : [],
  };
}
