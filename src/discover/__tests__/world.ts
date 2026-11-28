// Made-up catalogs described by names, for tests that need a particular shape of credits.
import { buildCatalog, type RawCatalog } from "../lib/catalog";
import { buildGraph, type Graph } from "../lib/graph";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Who, in what role, and the detail (an instrument, say). */
export type Cred = [who: string, role: string, detail?: string];

export type WorldSpec = {
  /** Artists with full pages, best known first. */
  artists: string[];
  /** Artists without full pages, so never "well known". */
  others?: string[];
  songs?: [title: string, year: number | null, credits: Cred[]][];
  /** Albums by `by`, on the label at that position if one is given. */
  releases?: [title: string, year: number | null, by: string[], credits: Cred[], label?: number][];
  relations?: [subject: string, type: string, object: string][];
  /** Genre positions (0 pop, 1 rock) and shares, in percent. */
  genres?: Record<string, [genre: number, share: number][]>;
};

export function world(spec: WorldSpec): Graph {
  const names = [...spec.artists, ...(spec.others ?? [])];
  const at = (name: string) => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`no artist called ${name}`);
    return i;
  };
  const roles: string[] = [];
  const details = [""];
  const relationTypes: string[] = [];
  const index = (list: string[], value: string) => {
    const i = list.indexOf(value);
    return i < 0 ? list.push(value) - 1 : i;
  };
  const flat = (credits: Cred[]) =>
    credits.flatMap(([who, role, detail = ""]) => [at(who), index(roles, role), index(details, detail)]);
  const full = (i: number) => i < spec.artists.length;
  const raw: RawCatalog = {
    version: 1,
    roles,
    details,
    relationTypes,
    artists: names.map((name, i) => [
      uuid(100 + i),
      name,
      "Person",
      null,
      null,
      null,
      null,
      full(i) ? 2 : 0,
      full(i) ? 100_000 - i : null,
      (spec.genres?.[name] ?? []).flat(),
      [],
    ]),
    extras: {},
    photos: {},
    genres: [
      ["pop", "pop", []],
      ["rock", "rock", []],
    ],
    labels: [
      [uuid(900), "One Label"],
      [uuid(901), "Other Label"],
    ],
    songs: (spec.songs ?? []).map(([title, year, credits], i) => [
      uuid(2000 + i),
      title,
      year,
      null,
      flat(credits),
    ]),
    releases: (spec.releases ?? []).map(([title, year, by, credits, label], i) => [
      uuid(5000 + i),
      title,
      year,
      null,
      by.map(at),
      label === undefined ? [] : [label],
      [],
      flat(credits),
    ]),
    relations: (spec.relations ?? []).map(([subject, type, object]) => [
      at(subject),
      at(object),
      index(relationTypes, type),
      null,
      null,
    ]),
  };
  return buildGraph(buildCatalog(raw));
}

/** `count` songs by `artist`, each crediting `who` as `role` (with `detail`), from `year` on. */
export function songsBy(
  artist: string,
  count: number,
  who: string,
  role: string,
  detail = "",
  year = 2000,
): [string, number | null, Cred[]][] {
  return Array.from({ length: count }, (_, i) => [
    `${artist} ${who} ${role} ${detail} ${i}`,
    year + i,
    [
      [artist, "primary"],
      [who, role, detail],
    ],
  ]);
}
