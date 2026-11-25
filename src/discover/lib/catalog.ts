// Reads src/discover/data/catalog.json (written by scripts/discover/export_catalog.py) and indexes it.
// Server only. Inside the catalog everything is a position in its list; IDs outside are MusicBrainz
// IDs (genres use a slug), so links work across the whole app.
import { readFileSync } from "node:fs";
import path from "node:path";

type Honor = [id: string, name: string, year: number | null];
type ChartTotals = [
  entries: number,
  topTen: number,
  numberOnes: number,
  peak: number,
  first: number,
  last: number,
];
type Extras = {
  facts?: [
    description: string | null,
    wikipedia: string | null,
    awards: Honor[],
    nominations: Honor[],
    wikidata: string | null,
  ];
  hot100?: ChartTotals;
  albums?: ChartTotals;
  eurovision?: [
    year: number,
    country: string,
    song: string,
    place: number | null,
    points: number | null,
    semi: number | null,
  ][];
  events?: [id: string, name: string, date: string | null, place: string | null][];
  eventCount?: number;
};

/** A freely licensed photo on Wikimedia Commons, with the credit its license asks for. */
export type Photo = {
  url: string;
  page: string;
  author: string | null;
  license: string;
  licenseUrl: string | null;
};
type RawPhoto = [
  url: string,
  page: string,
  author: string | null,
  license: string,
  licenseUrl: string | null,
];

export type RawCatalog = {
  version: number;
  roles: string[];
  details: string[];
  relationTypes: string[];
  artists: [
    id: string,
    name: string,
    type: string | null,
    country: string | null,
    disambiguation: string | null,
    begin: number | null,
    end: number | null,
    level: number,
    listeners: number | null,
    genres: number[],
    aliases: string[],
  ][];
  extras: Record<string, Extras>;
  photos: Record<string, RawPhoto>;
  genres: [name: string, slug: string, parents: number[]][];
  labels: [id: string, name: string][];
  songs: [
    id: string,
    title: string,
    year: number | null,
    seconds: number | null,
    credits: number[],
  ][];
  releases: [
    id: string,
    title: string,
    year: number | null,
    cover: string | null,
    artists: number[],
    labels: number[],
    tracks: number[],
    credits: number[],
  ][];
  relations: [
    subject: number,
    object: number,
    type: number,
    begin: number | null,
    end: number | null,
  ][];
};

export type Credit = { artist: number; role: string; detail: string };
export type Artist = {
  id: string;
  name: string;
  type: string | null;
  country: string | null;
  disambiguation: string | null;
  begin: number | null;
  end: number | null;
  level: number;
  listeners: number | null;
  genres: { genre: number; share: number }[];
  aliases: string[];
  photo: Photo | null;
  extras: Extras;
};
export type Song = {
  id: string;
  title: string;
  year: number | null;
  seconds: number | null;
  credits: Credit[];
  primary: number[];
};
export type Release = {
  id: string;
  title: string;
  year: number | null;
  cover: string | null;
  artists: number[];
  labels: number[];
  tracks: number[];
  credits: Credit[];
};
export type Relation = {
  subject: number;
  object: number;
  type: string;
  begin: number | null;
  end: number | null;
};

export type Catalog = {
  artists: Artist[];
  songs: Song[];
  releases: Release[];
  labels: { id: string; name: string }[];
  genres: { name: string; slug: string; parents: number[]; children: number[] }[];
  relations: Relation[];
  artistAt: Map<string, number>;
  songAt: Map<string, number>;
  labelAt: Map<string, number>;
  genreAt: Map<string, number>;
  /** Songs, releases and relations each artist appears on, and each song's releases. */
  songsOf: number[][];
  releasesOf: number[][];
  relationsOf: number[][];
  songReleases: number[][];
  labelReleases: number[][];
  genreArtists: number[][];
};

function creditsOf(flat: number[], raw: RawCatalog): Credit[] {
  const out: Credit[] = [];
  for (let i = 0; i < flat.length; i += 3) {
    out.push({ artist: flat[i], role: raw.roles[flat[i + 1]], detail: raw.details[flat[i + 2]] });
  }
  return out;
}

function photoOf(raw: RawPhoto | undefined): Photo | null {
  if (!raw) return null;
  const [url, page, author, license, licenseUrl] = raw;
  return { url, page, author, license, licenseUrl };
}

const lists = (length: number): number[][] => Array.from({ length }, () => []);
const position = <T>(rows: T[], key: (row: T) => string) =>
  new Map(rows.map((row, i) => [key(row), i]));

function push(list: number[], value: number) {
  if (list[list.length - 1] !== value) list.push(value);
}

/** Turns the exported file into indexed records. */
export function buildCatalog(raw: RawCatalog): Catalog {
  const artists: Artist[] = raw.artists.map(
    (
      [id, name, type, country, disambiguation, begin, end, level, listeners, genres, aliases],
      i,
    ) => ({
      id,
      name,
      type,
      country,
      disambiguation,
      begin,
      end,
      level,
      listeners,
      genres: Array.from({ length: genres.length / 2 }, (_, g) => ({
        genre: genres[2 * g],
        share: genres[2 * g + 1],
      })),
      aliases,
      photo: photoOf(raw.photos[i]),
      extras: raw.extras[i] ?? {},
    }),
  );
  const songs: Song[] = raw.songs.map(([id, title, year, seconds, flat]) => {
    const credits = creditsOf(flat, raw);
    return {
      id,
      title,
      year,
      seconds,
      credits,
      primary: [...new Set(credits.filter((c) => c.role === "primary").map((c) => c.artist))],
    };
  });
  const releases: Release[] = raw.releases.map(
    ([id, title, year, cover, by, labels, tracks, flat]) => ({
      id,
      title,
      year,
      cover,
      artists: by,
      labels,
      tracks,
      credits: creditsOf(flat, raw),
    }),
  );
  const relations: Relation[] = raw.relations.map(([subject, object, type, begin, end]) => ({
    subject,
    object,
    type: raw.relationTypes[type],
    begin,
    end,
  }));
  const genres = raw.genres.map(([name, slug, parents]) => ({
    name,
    slug,
    parents,
    children: [] as number[],
  }));
  genres.forEach((genre, i) => genre.parents.forEach((parent) => genres[parent].children.push(i)));

  const songsOf = lists(artists.length);
  const releasesOf = lists(artists.length);
  const relationsOf = lists(artists.length);
  const songReleases = lists(songs.length);
  const labelReleases = lists(raw.labels.length);
  const genreArtists = lists(genres.length);
  songs.forEach((song, i) => song.credits.forEach((c) => push(songsOf[c.artist], i)));
  releases.forEach((release, i) => {
    for (const artist of new Set([...release.artists, ...release.credits.map((c) => c.artist)]))
      releasesOf[artist].push(i);
    release.tracks.forEach((song) => push(songReleases[song], i));
    release.labels.forEach((label) => push(labelReleases[label], i));
  });
  relations.forEach((relation, i) => {
    relationsOf[relation.subject].push(i);
    if (relation.object !== relation.subject) relationsOf[relation.object].push(i);
  });
  artists.forEach((artist, i) => artist.genres.forEach((g) => genreArtists[g.genre].push(i)));

  return {
    artists,
    songs,
    releases,
    relations,
    genres,
    labels: raw.labels.map(([id, name]) => ({ id, name })),
    artistAt: position(artists, (a) => a.id),
    songAt: position(songs, (s) => s.id),
    labelAt: position(raw.labels, (l) => l[0]),
    genreAt: position(genres, (g) => g.slug),
    songsOf,
    releasesOf,
    relationsOf,
    songReleases,
    labelReleases,
    genreArtists,
  };
}

let loaded: Catalog | null = null;

/** The catalog, read once per server instance. */
export function catalog(): Catalog {
  loaded ??= buildCatalog(
    JSON.parse(
      readFileSync(path.join(process.cwd(), "src/discover/data/catalog.json"), "utf8"),
    ) as RawCatalog,
  );
  return loaded;
}
