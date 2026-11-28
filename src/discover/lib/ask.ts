// Ask: a question in plain words, read as one of a fixed set of questions and answered from the
// catalog. The words only choose the question and name the artists or songs; every fact in an
// answer comes from the credits. Server only.
import type { Catalog } from "./catalog";
import { collaborations, type CollaborationType, type Direction } from "./collaborations";
import { creditGroups } from "./credits";
import { countOf, evidenceBetween, neighbors, type Graph } from "./graph";
import { connectionsHref, sixDegreesHref } from "./links";
import { normalize, searchCatalog } from "./search";
import { searchPaths } from "./server";
import {
  DEFAULT_CATEGORIES,
  WORKING_CATEGORIES,
  type ArtistRef,
  type EntityRef,
  type PathSearch,
  type Reason,
} from "./types";
import { artistRef, reasonOf, songRef } from "./words";

export type CreditRole = "producer" | "featured" | "performer" | "all";

/** A question as read: what it asks, and the names as written. */
export type Question =
  | { intent: "path"; a: string; b: string; strongest: boolean }
  | { intent: "compare"; a: string; b: string }
  | { intent: "credits"; song: string; role: CreditRole }
  | {
      intent: "collaborators";
      artist: string;
      type: CollaborationType | null;
      direction: Direction | null;
    }
  | { intent: "sampled"; artist: string }
  | { intent: "connections"; artist: string }
  | { intent: "lookup"; text: string }
  | { intent: "unknown" };

const FILLER =
  /^(?:(?:hey|hi|ok|okay|so|um|please)\b[,!]?\s*|(?:can|could|would) you (?:please )?(?:tell me|show me|find)\s+|(?:tell me|show me|i wonder|do you know|i want to know)[,:]?\s+)+/i;

/** Plain quotes, single spaces, and no greeting or closing punctuation. */
export function cleanQuestion(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(FILLER, "")
    .replace(/[\s?!.,;:]+$/, "");
}

/** A name as written in a question, without quotes, "the song" or "together". */
export function nameOf(raw: string): string {
  return raw
    .trim()
    .replace(/^"(.+)"$/, "$1")
    .replace(
      /^(?:the (?:song|track|single|artist|rapper|singer|band|producer|group) |(?:song|track|single|artist|rapper|singer|band|producer) )/i,
      "",
    )
    .replace(/(?: together| ever| before| at all| the most| most often| most| often)+$/i, "")
    .replace(/'s$/i, "")
    .trim();
}

const WORKED =
  "(?:worked|work|collaborated|collaborate|recorded|record|performed|perform|made music|teamed up|played|appeared|featured?)";
const CONNECTED = "(?:connected|linked|related|tied|connect|link)";
const PEOPLE = "(?:artists?|musicians?|people|singers?|rappers?|bands?|groups?|producers?|acts?)";
const A = "(?<a>.+?)";
const B = "(?<b>.+?)";
const S = "(?<s>.+)";

type Build = (m: Record<string, string>, text: string) => Question;

const path = (m: Record<string, string>, text: string): Question => ({
  intent: "path",
  a: nameOf(m.a),
  b: nameOf(m.b),
  strongest: /\b(?:strongest|closest)\b/i.test(text),
});
const compare = (m: Record<string, string>): Question => ({
  intent: "compare",
  a: nameOf(m.a),
  b: nameOf(m.b),
});
const credits =
  (role: CreditRole) =>
  (m: Record<string, string>): Question => ({ intent: "credits", song: m.s.trim(), role });
const collaborators =
  (type: CollaborationType | null, direction: Direction | null = null) =>
  (m: Record<string, string>): Question => ({
    intent: "collaborators",
    artist: nameOf(m.a),
    type,
    direction,
  });
const connections = (m: Record<string, string>): Question => ({
  intent: "connections",
  artist: nameOf(m.a),
});

const RULES: [RegExp, Build][] = (
  [
    // Who produced for an artist, before "who produced <a song>".
    [`who (?:has |have )?(?:produced|produces|made beats) for ${A}`, collaborators("production", "produced by them")],
    [`(?:who|what|which artists) (?:has|did|does) ${A} (?:produced?|made beats|make beats)(?: for)?`, collaborators("production", "produced for them")],
    [`(?:who|which artists) (?:has|did|does) ${A} (?:featured?|bring on|brought on)(?: on| with)?(?: (?:songs?|tracks?|music))?`, collaborators("features")],
    // Paths.
    [`${A} ?(?:->|→|=>) ?${B}`, path],
    [`how (?:is|are|was|were|does|do|did) ${A} ${CONNECTED} (?:to|with) ${B}`, path],
    [`how (?:is|are|was|were|do|does|did) ${A} and ${B} ${CONNECTED}(?: together)?`, path],
    [`(?:is|are|was|were) ${A} ${CONNECTED} (?:to|with) ${B}`, path],
    [`(?:is|are|was|were) ${A} and ${B} ${CONNECTED}(?: together)?`, path],
    [`(?:what(?:'s| is| are) )?(?:the )?(?:shortest |strongest |closest |quickest )?(?:path|connection|link|route|chain|way)s? (?:from|between) ${A} (?:to|and) ${B}`, path],
    [`(?:six|6) degrees(?: of separation)?(?: from| between| of)? ${A} (?:to|and) ${B}`, path],
    [`(?:how many )?(?:steps|degrees|hops)(?: of separation)? (?:from|between) ${A} (?:to|and) ${B}`, path],
    [`how (?:far|close) (?:is|are) ${A} (?:from|to) ${B}`, path],
    [`how (?:far apart|close) are ${A} and ${B}`, path],
    [`(?:did|has|have|does|do) ${A} (?:ever )?${WORKED}(?: on a song| on a track)? (?:with|alongside) ${B}`, path],
    [`(?:did|have|has|do) ${A} and ${B} (?:ever )?${WORKED}(?: together)?`, path],
    [`(?:connect|link) ${A} (?:to|and|with) ${B}`, path],
    [`from ${A} to ${B}`, path],
    // Comparisons.
    [`compare (?:the )?(?:(?:songs?|tracks?|artists?) )?${A} (?:and|vs\\.?|versus|with|to|&) ${B}`, compare],
    [`(?:what(?:'s| is| are) )?(?:the )?(?:differences?|similarit(?:y|ies)|overlap) between ${A} and ${B}`, compare],
    [`what do ${A} and ${B} have in common`, compare],
    [`how (?:does|do|is|are) ${A} compare (?:to|with) ${B}`, compare],
    [`${A} (?:vs\\.?|versus|compared (?:to|with)) ${B}`, compare],
    // Who an artist is connected to.
    [`(?:(?:similar |related |more )?${PEOPLE}|music|more|someone|anyone) (?:like|similar to|connected to|related to|close to|linked to) ${A}`, connections],
    [`(?:who|what ${PEOPLE}|which ${PEOPLE}) (?:is|are) (?:similar to|like|connected to|related to|close to|linked to) ${A}`, connections],
    [`(?:who|what) (?:else )?(?:should i|can i) (?:listen to|check out|try) (?:if i like|after) ${A}`, connections],
    [`(?:explore|web of|network of|connections of|for fans of|fans of|if i like) ${A}`, connections],
    // A song's credits.
    [`who (?:produced|made the beat (?:for|on|of)) ${S}`, credits("producer")],
    [`(?:who(?:'s| is| was| are| were) )?(?:the )?producers? (?:of|on|for|behind) ${S}`, credits("producer")],
    [`who(?:'s| is| was| are| were) (?:the )?(?:featured|features?|guests?)(?: artists?)? (?:on|in) ${S}`, credits("featured")],
    [`who (?:features|featured|is featured|was featured|appears|appeared|raps|rapped) (?:on|in) ${S}`, credits("featured")],
    [`(?:features?|guests?) (?:on|in) ${S}`, credits("featured")],
    [`who (?:sang|sings|performed|performs|recorded|released) ${S}`, credits("performer")],
    [`(?:(?:full |all )?credits|who(?:'s| is| was| were) credited) (?:for|on|of) ${S}`, credits("all")],
    [`who (?:worked on|made|played on|is credited on|contributed to|is on|was on) ${S}`, credits("all")],
    // An artist's collaborators.
    [`(?:who|which ${PEOPLE}) (?:has|have|did|does|do) ${A} (?:ever )?${WORKED} with(?: the most| most(?: often)?)?`, collaborators(null)],
    [`who (?:has |have )?(?:worked|collaborated|performed|recorded) with ${A}`, collaborators(null)],
    [`(?:which|what) (?:bands|groups|projects) (?:is|was|has|have|were) ${A} (?:been )?(?:in|a member of|part of)`, collaborators("bands")],
    [`who (?:sampled|samples|has sampled) ${A}`, (m) => ({ intent: "sampled", artist: nameOf(m.a) })],
    [`${A}(?:'s|') (?:collaborators|collaborations)`, collaborators(null)],
    [`${A}(?:'s|') (?:features|duets)`, collaborators("features")],
    [`${A}(?:'s|') (?:producers)`, collaborators("production", "produced by them")],
    [`(?<s>.+?) (?:song )?credits`, credits("all")],
  ] satisfies [string, Build][]
).map(([pattern, build]) => [new RegExp(`^${pattern}$`, "i"), build]);

/** A question starts with one of these, or it is a name to look up. */
const ASKING =
  /^(?:who|whom|what|which|how|why|when|where|did|does|do|is|are|was|were|has|have|can|could|should|would|will|list|show|tell|find|compare)\b/i;
export const MAX_LOOKUP_WORDS = 6;

/** Reads a question; anything else short is a name to search for. */
export function parseQuestion(raw: string): Question {
  const text = cleanQuestion(raw);
  for (const [pattern, build] of RULES) {
    const match = pattern.exec(text);
    if (match) return build(match.groups!, text);
  }
  if (text && !ASKING.test(text) && text.split(" ").length <= MAX_LOOKUP_WORDS)
    return { intent: "lookup", text: nameOf(text) };
  return { intent: "unknown" };
}

// --- Answers -----------------------------------------------------------------------------------

/** What a name in the question was taken to mean. */
export type Took = { said: string; ref: EntityRef };
export type CreditPerson = { artist: ArtistRef; parts: string[] };
export type Count = { artist: ArtistRef; count: number };

export type Answer =
  | { kind: "path"; reading: string; took: Took[]; from: ArtistRef; to: ArtistRef; result: PathSearch; href: string }
  | {
      kind: "compare";
      reading: string;
      took: Took[];
      a: ArtistRef;
      b: ArtistRef;
      linked: Reason[];
      linkedTotal: number;
      shared: ArtistRef[];
      sharedTotal: number;
      genres: EntityRef[];
      labels: EntityRef[];
      exploreHref: string;
      pathHref: string;
    }
  | { kind: "compare-songs"; reading: string; took: Took[]; a: EntityRef; b: EntityRef; shared: CreditPerson[]; exploreHref: string }
  | { kind: "credits"; reading: string; took: Took[]; song: EntityRef; role: CreditRole; groups: { title: string; people: CreditPerson[] }[] }
  | { kind: "collaborators"; reading: string; took: Took[]; artist: ArtistRef; items: Count[]; total: number; href: string }
  | { kind: "sampled"; reading: string; took: Took[]; artist: ArtistRef; reasons: Reason[]; total: number }
  | { kind: "connections"; reading: string; took: Took[]; artist: ArtistRef; items: ArtistRef[]; total: number; href: string }
  | { kind: "lookup"; reading: string; results: EntityRef[] }
  | { kind: "missing"; reading: string; names: string[]; what: "artist" | "song" | "artist or song" }
  | { kind: "unknown" };

/** How many people a list in an answer shows. */
export const SHOWN = 12;

const at = (c: Catalog, ref: EntityRef, kind: "artist" | "song") =>
  (kind === "artist" ? c.artistAt : c.songAt).get(ref.id)!;

function findArtist(c: Catalog, name: string): Took | null {
  const [ref] = searchCatalog(c, name, ["artist"], 1);
  return ref ? { said: name, ref } : null;
}

/** A song as named: "Umbrella", "Umbrella by Rihanna" or "Rihanna's Umbrella", tried in turn. */
function findSong(c: Catalog, raw: string): Took | null {
  const said = nameOf(raw);
  const tries: [title: string, by: string | null][] = [];
  const by = /^(.+?) (?:by|from) (.+)$/i.exec(said);
  if (by) tries.push([nameOf(by[1]), nameOf(by[2])]);
  const owner = /^(.+?)(?:'s|') (.+)$/i.exec(said);
  if (owner) tries.push([nameOf(owner[2]), nameOf(owner[1])]);
  tries.push([said, null]);
  for (const [title, artist] of tries) {
    const found = searchCatalog(c, title, ["song"], 40);
    const wanted = artist && normalize(artist);
    const ref = wanted ? found.find((s) => normalize(s.note).includes(wanted)) : found[0];
    if (ref) return { said, ref };
  }
  return null;
}

const missing = (reading: string, names: string[], what: "artist" | "song" | "artist or song" = "artist"): Answer => ({
  kind: "missing",
  reading,
  names,
  what,
});

function pathAnswer(g: Graph, q: Extract<Question, { intent: "path" }>): Answer {
  const c = g.catalog;
  const took = [findArtist(c, q.a), findArtist(c, q.b)];
  const reading = `How ${q.a} is connected to ${q.b}`;
  if (!took[0] || !took[1]) return missing(reading, [q.a, q.b].filter((_, i) => !took[i]));
  const [a, b] = [at(c, took[0].ref, "artist"), at(c, took[1].ref, "artist")];
  const [from, to] = [artistRef(c, a), artistRef(c, b)];
  const order = q.strongest ? "strongest" : "shortest";
  return {
    kind: "path",
    reading: `How ${from.name} is connected to ${to.name}${q.strongest ? ", through the closest working relationships" : ""}`,
    took: took as Took[],
    from,
    to,
    result: searchPaths(g, a, b, DEFAULT_CATEGORIES, order),
    href: sixDegreesHref({ from, to, order }),
  };
}

function labelsOf(c: Catalog, artist: number): Set<number> {
  return new Set(
    c.releasesOf[artist].flatMap((r) => (c.releases[r].artists.includes(artist) ? c.releases[r].labels : [])),
  );
}

function compareAnswer(g: Graph, q: Extract<Question, { intent: "compare" }>): Answer {
  const c = g.catalog;
  const reading = `What ${q.a} and ${q.b} have in common`;
  const artists = [findArtist(c, q.a), findArtist(c, q.b)];
  if (!artists[0] || !artists[1]) {
    const songs = [findSong(c, q.a), findSong(c, q.b)];
    if (songs[0] && songs[1]) return compareSongs(c, songs as Took[]);
    const neither = [q.a, q.b].filter((_, i) => !artists[i] && !songs[i]);
    // One artist and one song: only like with like compares.
    return neither.length
      ? missing(reading, neither, "artist or song")
      : missing(reading, [q.a, q.b].filter((_, i) => !artists[i]));
  }
  const [x, y] = [at(c, artists[0].ref, "artist"), at(c, artists[1].ref, "artist")];
  const [a, b] = [artistRef(c, x), artistRef(c, y)];
  const linked = evidenceBetween(c, x, y, WORKING_CATEGORIES);
  const near = new Map(neighbors(g, x, WORKING_CATEGORIES).map((n) => [n.artist, n.strength]));
  const shared = neighbors(g, y, WORKING_CATEGORIES)
    .filter((n) => n.artist !== x && near.has(n.artist))
    .map((n) => ({ artist: n.artist, strength: Math.min(n.strength, near.get(n.artist)!) }))
    .sort((p, r) => r.strength - p.strength || p.artist - r.artist);
  const theirGenres = new Set(c.artists[y].genres.map((genre) => genre.genre));
  const theirLabels = labelsOf(c, y);
  return {
    kind: "compare",
    reading: `What ${a.name} and ${b.name} have in common`,
    took: artists as Took[],
    a,
    b,
    linked: linked.slice(0, 3).map((e) => reasonOf(c, e)),
    linkedTotal: linked.length,
    shared: shared.slice(0, SHOWN).map((s) => artistRef(c, s.artist)),
    sharedTotal: shared.length,
    genres: c.artists[x].genres
      .filter((genre) => theirGenres.has(genre.genre))
      .map(({ genre }) => ({ kind: "genre", id: c.genres[genre].slug, name: c.genres[genre].name, note: "" })),
    labels: [...labelsOf(c, x)]
      .filter((label) => theirLabels.has(label))
      .map((label) => ({ kind: "label", id: c.labels[label].id, name: c.labels[label].name, note: "" })),
    exploreHref: `/compare/artists?artistA=${a.id}&artistB=${b.id}`,
    pathHref: sixDegreesHref({ from: a, to: b }),
  };
}

function people(c: Catalog, list: { artist: number; parts: string[] }[]): CreditPerson[] {
  return list.map((p) => ({ artist: artistRef(c, p.artist), parts: p.parts }));
}

function compareSongs(c: Catalog, took: Took[]): Answer {
  const [x, y] = took.map((t) => c.songs[at(c, t.ref, "song")]);
  const [a, b] = took.map((t) => songRef(c, at(c, t.ref, "song")));
  const theirs = new Set(y.credits.map((credit) => credit.artist));
  const both = creditGroups(x.credits.filter((credit) => theirs.has(credit.artist))).flatMap((group) => group.people);
  const seen = new Set<number>();
  return {
    kind: "compare-songs",
    reading: `What “${a.name}” and “${b.name}” have in common`,
    took,
    a,
    b,
    shared: people(
      c,
      both.filter((p) => !seen.has(p.artist) && seen.add(p.artist)),
    ),
    exploreHref: `/compare/songs?songA=${a.id}&songB=${b.id}`,
  };
}

const CREDIT_READINGS: Record<CreditRole, (title: string) => string> = {
  producer: (title) => `Who produced “${title}”`,
  featured: (title) => `Who is featured on “${title}”`,
  performer: (title) => `Who performed “${title}”`,
  all: (title) => `Everyone credited on “${title}”`,
};

/** What a song question means when it names an artist instead: "who produced Drake". */
const ARTIST_INSTEAD: Record<CreditRole, [CollaborationType | null, Direction | null]> = {
  producer: ["production", "produced by them"],
  featured: ["features", null],
  performer: [null, null],
  all: [null, null],
};

function creditsAnswer(g: Graph, q: Extract<Question, { intent: "credits" }>): Answer {
  const c = g.catalog;
  const took = findSong(c, q.song);
  if (!took) {
    const [type, direction] = ARTIST_INSTEAD[q.role];
    const artist = nameOf(q.song);
    if (findArtist(c, artist)) return collaboratorsAnswer(g, { intent: "collaborators", artist, type, direction });
    return missing(CREDIT_READINGS[q.role](nameOf(q.song)), [nameOf(q.song)], "song");
  }
  const song = c.songs[at(c, took.ref, "song")];
  const groups = creditGroups(song.credits)
    .map((group) => {
      if (q.role === "all") return group;
      if (q.role === "producer") return group.title === "Producers" ? group : null;
      if (group.title !== "Performers") return null;
      const featured = (p: { parts: string[] }) => p.parts.includes("featured");
      return { ...group, people: group.people.filter((p) => featured(p) === (q.role === "featured")) };
    })
    .filter((group) => group !== null && group.people.length > 0)
    .map((group) => ({ title: group!.title, people: people(c, group!.people) }));
  return {
    kind: "credits",
    reading: CREDIT_READINGS[q.role](took.ref.name),
    took: [took],
    song: took.ref,
    role: q.role,
    groups,
  };
}

function collaboratorsReading(name: string, type: CollaborationType | null, direction: Direction | null) {
  if (type === "features") return `Who ${name} performed with`;
  if (type === "bands") return `The bands and projects ${name} is part of`;
  // Production questions always say who produced for whom.
  if (type === "production")
    return direction === "produced by them" ? `Who produced for ${name}` : `Who ${name} produced for`;
  return `Who ${name} worked with most`;
}

function collaboratorsAnswer(g: Graph, q: Extract<Question, { intent: "collaborators" }>): Answer {
  const c = g.catalog;
  const took = findArtist(c, q.artist);
  if (!took) return missing(collaboratorsReading(q.artist, q.type, q.direction), [q.artist]);
  const a = at(c, took.ref, "artist");
  const artist = artistRef(c, a);
  let items: Count[];
  if (q.type === null) {
    items = neighbors(g, a, WORKING_CATEGORIES).map((n) => ({
      artist: artistRef(c, n.artist),
      count: countOf(n.edge, WORKING_CATEGORIES),
    }));
  } else {
    const all = collaborations(g, a, q.type, Infinity).items;
    items = all
      .filter((item) => !q.direction || item.directions.includes(q.direction))
      .map((item) => ({ artist: item.artist, count: item.count }));
  }
  return {
    kind: "collaborators",
    reading: collaboratorsReading(artist.name, q.type, q.direction),
    took: [took],
    artist,
    items: items.slice(0, SHOWN),
    total: items.length,
    href: connectionsHref(artist.id, q.type === null ? WORKING_CATEGORIES : DEFAULT_CATEGORIES),
  };
}

function sampledAnswer(g: Graph, q: Extract<Question, { intent: "sampled" }>): Answer {
  const c = g.catalog;
  const took = findArtist(c, q.artist);
  if (!took) return missing(`Who sampled ${q.artist}`, [q.artist]);
  const a = at(c, took.ref, "artist");
  const found = neighbors(g, a, ["samples"]).flatMap((n) =>
    evidenceBetween(c, a, n.artist, ["samples"]).filter((e) => e.a === a),
  );
  found.sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999));
  const artist = artistRef(c, a);
  return {
    kind: "sampled",
    reading: `Who sampled ${artist.name}`,
    took: [took],
    artist,
    reasons: found.slice(0, SHOWN).map((e) => reasonOf(c, e)),
    total: found.length,
  };
}

function connectionsAnswer(g: Graph, q: Extract<Question, { intent: "connections" }>): Answer {
  const c = g.catalog;
  const took = findArtist(c, q.artist);
  if (!took) return missing(`Artists connected to ${q.artist}`, [q.artist]);
  const a = at(c, took.ref, "artist");
  const artist = artistRef(c, a);
  const all = neighbors(g, a, DEFAULT_CATEGORIES);
  return {
    kind: "connections",
    reading: `Artists connected to ${artist.name}`,
    took: [took],
    artist,
    items: all.slice(0, SHOWN).map((n) => artistRef(c, n.artist)),
    total: all.length,
    href: connectionsHref(artist.id, DEFAULT_CATEGORIES),
  };
}

/** Answers a question from the catalog. */
export function ask(g: Graph, raw: string): Answer {
  const q = parseQuestion(raw);
  switch (q.intent) {
    case "path":
      return pathAnswer(g, q);
    case "compare":
      return compareAnswer(g, q);
    case "credits":
      return creditsAnswer(g, q);
    case "collaborators":
      return collaboratorsAnswer(g, q);
    case "sampled":
      return sampledAnswer(g, q);
    case "connections":
      return connectionsAnswer(g, q);
    case "lookup":
      return {
        kind: "lookup",
        reading: `Search for “${q.text}”`,
        results: searchCatalog(g.catalog, q.text, ["artist", "song", "label", "genre"], SHOWN),
      };
    default:
      return { kind: "unknown" };
  }
}
