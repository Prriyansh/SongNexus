// Puts the catalog's facts into sentences.
import type { Artist, Catalog } from "./catalog";
import { KIND_RULES, type Evidence } from "./graph";
import type { ArtistRef, EntityRef, Reason } from "./types";

const countries = new Intl.DisplayNames(["en"], { type: "region" });

/** A country's English name; MusicBrainz's special codes (XW, worldwide) and unknown ones give none. */
export function countryName(code: string | null): string | null {
  if (!code || code.startsWith("X")) return null;
  try {
    const name = countries.of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/** What tells an artist apart from a namesake: the source's own words, else genre and country. */
export function artistNote(catalog: Catalog, artist: Artist): string {
  if (artist.disambiguation) return artist.disambiguation;
  const genre = artist.genres.length ? catalog.genres[artist.genres[0].genre].name : null;
  return [genre, countryName(artist.country)].filter(Boolean).join(" · ");
}

export function artistRef(catalog: Catalog, at: number): ArtistRef {
  const artist = catalog.artists[at];
  return {
    id: artist.id,
    name: artist.name,
    note: artistNote(catalog, artist),
    listeners: artist.listeners,
    photo: artist.photo?.url ?? null,
  };
}

/** The cover of the first of a song's albums that has one. */
export function songCover(catalog: Catalog, at: number): string | null {
  const release = catalog.songReleases[at].find((r) => catalog.releases[r].cover);
  return release === undefined ? null : catalog.releases[release].cover;
}

export function songRef(catalog: Catalog, at: number): EntityRef {
  const song = catalog.songs[at];
  return {
    kind: "song",
    id: song.id,
    name: song.title,
    note: song.primary.map((a) => catalog.artists[a].name).join(", "),
    image: songCover(catalog, at),
  };
}

const PARTS: Record<string, string> = {
  programming: "programming",
  arranger: "the arrangement",
  conductor: "conducting",
  remixer: "the remix",
};

/** "guitar" for an instrument, "vocals" for a voice: how someone took part. */
export function partName(role: string, detail: string): string {
  if (role === "instrument") return detail || "an instrument";
  if (role === "vocal") return detail || "vocals";
  return PARTS[role] ?? (detail || "a performance");
}

/** One per relationship the graph keeps (its RELATION_KINDS); others never become evidence. */
const RELATION_TEXT: Record<string, (a: string, b: string) => string> = {
  member_of: (a, b) => `${a} is or was a member of ${b}`,
  has_subgroup: (a, b) => `${b} is a subgroup of ${a}`,
  performs_as: (a, b) => `${a} performs as ${b}`,
  collaboration_in: (a, b) => `${a} is part of ${b}`,
  supported: (a, b) => `${a} played in the band of ${b}`,
  taught: (a, b) => `${a} taught ${b}`,
};

const relationText = (type: string, a: string, b: string) => RELATION_TEXT[type](a, b);

/** The song or album a fact is about, as it reads inside a sentence. */
function titleOf(catalog: Catalog, { type, at }: Evidence["subject"]): string {
  if (type === "song") return `“${catalog.songs[at].title}”`;
  return type === "release" ? `the album “${catalog.releases[at].title}”` : "";
}

function sentence(catalog: Catalog, e: Evidence): string {
  const a = catalog.artists[e.a].name;
  const b = catalog.artists[e.b].name;
  const title = titleOf(catalog, e.subject);
  switch (e.kind) {
    case "performed_with": {
      const featured = [e.aRole, e.bRole].filter((r) => r === "featured").length;
      if (featured === 0) return `${a} and ${b} performed ${title} together`;
      if (featured === 2) return `${a} and ${b} are both featured on ${title}`;
      return e.aRole === "featured"
        ? `${a} is featured on ${title} by ${b}`
        : `${b} is featured on ${title} by ${a}`;
    }
    case "produced_for":
      return `${a} produced ${title} by ${b}`;
    case "co_produced":
      return `${a} and ${b} both produced ${title}`;
    case "contributed_to":
      return `${a} is credited with ${partName(e.aRole, e.detail)} on ${title} by ${b}`;
    case "sampled":
      return `${title} by ${b} samples ${a}`;
    case "engineered":
      return `${a} engineered ${title} by ${b}`;
    case "label_mates":
      return `${a} and ${b} released albums on ${catalog.labels[e.subject.at].name} within three years of each other`;
    default:
      return relationText(e.aRole, a, b);
  }
}

export function reasonOf(catalog: Catalog, e: Evidence): Reason {
  const label = e.subject.type === "label" ? catalog.labels[e.subject.at] : null;
  const subject: EntityRef | null =
    e.subject.type === "song"
      ? songRef(catalog, e.subject.at)
      : label && { kind: "label", id: label.id, name: label.name, note: "Record label" };
  return {
    category: KIND_RULES[e.kind].category,
    text: sentence(catalog, e),
    subject,
    year: e.year,
  };
}
