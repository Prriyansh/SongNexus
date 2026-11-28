// Stories: short connection stories found in the catalog, each with the credits that prove it.
// Deterministic: one catalog always gives the same stories in the same order. Every claim is a
// fact the catalog holds, and "no credit links them" always means "in this catalog".
import { knownArtists } from "./browse";
import type { Catalog, Credit } from "./catalog";
import { countOf, evidenceBetween, strengthOf, type Evidence, type Graph } from "./graph";
import {
  DEFAULT_CATEGORIES,
  WORKING_CATEGORIES,
  type ArtistRef,
  type Category,
  type Reason,
} from "./types";
import { artistRef, partName, reasonOf } from "./words";

export type StoryKind =
  | "shared-producer"
  | "two-steps"
  | "session-player"
  | "label-mates"
  | "same-sample"
  | "sampled";

export type Story = {
  /** Stable while the catalog stays the same: the kind and the artists. */
  id: string;
  kind: StoryKind;
  title: string;
  text: string;
  /** Everyone the story names, the ones it is about first. */
  artists: ArtistRef[];
  /** The credits that prove it, the most telling first. */
  reasons: Reason[];
  /** Two artists whose path is worth opening in Six Degrees. */
  pair: [ArtistRef, ArtistRef] | null;
};

export const STORY_TITLES: Record<StoryKind, string> = {
  "shared-producer": "One producer, two worlds",
  "two-steps": "Two steps apart",
  "session-player": "The musician behind the songs",
  "label-mates": "Label mates",
  "same-sample": "The same sample, years apart",
  sampled: "Sampled",
};

/** Stories are about the best-known artists, so readers recognise them. */
export const POPULAR = 150;
/** Pairs for two-step stories come from the best-known of those. */
export const TWO_STEP_ARTISTS = 100;
export const MAX_PER_KIND = 24;
export const MAX_REASONS = 8;
/** A musician credited on at least this many of an artist's songs makes a story. */
export const MIN_SESSION_SONGS = 5;
/** Two uses of one sample at least this many years apart make a story. */
export const MIN_SAMPLE_GAP = 10;

type Candidate = {
  kind: StoryKind;
  /** Positions in the catalog: the artists it is about, then the one between them, if any. */
  artists: number[];
  text: string;
  evidence: Evidence[];
  pair: [number, number] | null;
  /** Higher first within its kind; not shown. */
  score: number;
};

type Context = {
  g: Graph;
  c: Catalog;
  rank: Map<number, number>;
  name: (at: number) => string;
  linked: (a: number, b: number, categories?: readonly Category[]) => boolean;
};

/** How much of two artists' genres they share, from 0 to 1 (shares are percentages). */
function genreOverlap(c: Catalog, a: number, b: number): number {
  const theirs = new Map(c.artists[b].genres.map((g) => [g.genre, g.share]));
  return c.artists[a].genres.reduce((sum, g) => sum + Math.min(g.share, theirs.get(g.genre) ?? 0), 0) / 100;
}

function* pairsOf<T>(items: readonly T[]): Generator<[T, T]> {
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) yield [items[i], items[j]];
}

const performerRoles = new Set(["primary", "featured"]);

function releaseCredits(c: Catalog, at: number): Credit[] {
  const release = c.releases[at];
  return [...release.artists.map((artist) => ({ artist, role: "primary", detail: "" })), ...release.credits];
}

function sharedProducer(ctx: Context): Candidate[] {
  const { c, rank, name, linked } = ctx;
  const produced = new Map<number, Set<number>>();
  const note = (credits: Credit[]) => {
    // Only songs that are theirs: a guest spot on someone else's song is a weaker story.
    const performers = credits.filter((x) => x.role === "primary" && rank.has(x.artist));
    for (const producer of credits.filter((x) => x.role === "producer")) {
      for (const { artist } of performers) {
        if (artist === producer.artist) continue;
        const own = produced.get(producer.artist) ?? new Set<number>();
        produced.set(producer.artist, own.add(artist));
      }
    }
  };
  c.songs.forEach((song) => note(song.credits));
  c.releases.forEach((_, at) => note(releaseCredits(c, at)));
  const stories: Candidate[] = [];
  for (const [producer, artists] of [...produced].sort(([x], [y]) => x - y)) {
    const best = [...artists].sort((x, y) => rank.get(x)! - rank.get(y)!).slice(0, 4);
    for (const [a, b] of pairsOf(best)) {
      // A pair with a credit together, or a producer in either one's band, is no story.
      if (linked(a, b) || linked(producer, a, ["bands"]) || linked(producer, b, ["bands"])) continue;
      const by = (artist: number) =>
        evidenceBetween(c, producer, artist, ["producers"]).filter(
          (e) => e.kind === "produced_for" && e.a === producer && e.bRole === "primary",
        );
      const [first, second] = [by(a), by(b)];
      stories.push({
        kind: "shared-producer",
        artists: [a, b, producer],
        text: `No credit links ${name(a)} and ${name(b)} in this catalog, but ${name(producer)} produced for both.`,
        evidence: [first[0], second[0], ...first.slice(1, 3), ...second.slice(1, 3)],
        pair: [a, b],
        score: -(rank.get(a)! + rank.get(b)!) - 500 * genreOverlap(c, a, b),
      });
      break; // the best pair for each producer is enough
    }
  }
  return stories;
}

function twoSteps(ctx: Context, popular: number[]): Candidate[] {
  const { g, c, rank, name } = ctx;
  const near = new Map(
    popular.map((a) => [
      a,
      new Map(
        [...g.edges[a]]
          .map(([other, edge]) => [other, strengthOf(edge, DEFAULT_CATEGORIES)] as const)
          .filter(([, strength]) => strength > 0),
      ),
    ]),
  );
  const stories: Candidate[] = [];
  for (const [a, b] of pairsOf(popular.slice(0, TWO_STEP_ARTISTS))) {
    const [nearA, nearB] = [near.get(a)!, near.get(b)!];
    if (nearA.has(b)) continue;
    let via = -1;
    let closest = 0;
    for (const [other, strength] of nearA) {
      const both = Math.min(strength, nearB.get(other) ?? 0);
      if (both > closest || (both === closest && both > 0 && other < via)) [via, closest] = [other, both];
    }
    if (via < 0) continue;
    const first = evidenceBetween(c, a, via, DEFAULT_CATEGORIES);
    const second = evidenceBetween(c, via, b, DEFAULT_CATEGORIES);
    stories.push({
      kind: "two-steps",
      artists: [a, b, via],
      text: `No credit links ${name(a)} and ${name(b)} in this catalog, but both worked with ${name(via)}.`,
      evidence: [first[0], second[0], ...first.slice(1, 2), ...second.slice(1, 2)],
      pair: [a, b],
      // Different scenes make the better story.
      score: -(rank.get(a)! + rank.get(b)!) / 2 - 40 * genreOverlap(c, a, b),
    });
  }
  return stories;
}

function sessionPlayers(ctx: Context, popular: number[]): Candidate[] {
  const { g, c, rank, name, linked } = ctx;
  const stories: Candidate[] = [];
  for (const a of popular) {
    let best: { other: number; songs: number; evidence: Evidence[] } | null = null;
    for (const [other, edge] of [...g.edges[a]].sort(([x], [y]) => x - y)) {
      // A band member credited on their own band's songs is no story.
      if (countOf(edge, ["contributions"]) < MIN_SESSION_SONGS || linked(a, other, ["bands"])) continue;
      const evidence = evidenceBetween(c, other, a, ["contributions"]).filter(
        (e) => e.a === other && e.subject.type === "song",
      );
      const songs = new Set(evidence.map((e) => e.subject.at)).size;
      if (songs >= MIN_SESSION_SONGS && (!best || songs > best.songs)) best = { other, songs, evidence };
    }
    if (!best) continue;
    const parts = new Map<string, number>();
    for (const e of best.evidence) {
      const part = partName(e.aRole, e.detail);
      parts.set(part, (parts.get(part) ?? 0) + 1);
    }
    const part = [...parts].sort((x, y) => y[1] - x[1])[0][0];
    stories.push({
      kind: "session-player",
      artists: [a, best.other],
      text: `${name(best.other)} is credited with ${part} on ${best.songs} of ${name(a)}’s songs in this catalog.`,
      evidence: best.evidence,
      pair: null,
      score: best.songs - rank.get(a)! / 10,
    });
  }
  return stories;
}

function labelMates(ctx: Context, popular: number[]): Candidate[] {
  const { g, c, rank, name } = ctx;
  const stories: Candidate[] = [];
  for (const [a, b] of pairsOf(popular)) {
    const edge = g.edges[a].get(b);
    // Every connection has some strength, so one with none from working together is a label.
    if (!edge || strengthOf(edge, WORKING_CATEGORIES) > 0) continue;
    const evidence = evidenceBetween(c, a, b, ["labels"]);
    const label = c.labels[evidence[0].subject.at].name;
    stories.push({
      kind: "label-mates",
      artists: [a, b],
      text: `Only a label links ${name(a)} and ${name(b)} in this catalog: both released albums on ${label} within three years of each other.`,
      evidence,
      pair: null,
      score: -(rank.get(a)! + rank.get(b)!),
    });
  }
  return stories;
}

type Use = { performer: number; song: number; year: number | null; evidence: Evidence };

function samples(ctx: Context): Candidate[] {
  const { c, rank, name } = ctx;
  const uses = new Map<number, Map<string, Use>>();
  c.songs.forEach((song, at) => {
    const performers = song.credits.filter((x) => performerRoles.has(x.role));
    for (const { artist: sampled } of song.credits.filter((x) => x.role === "sampled")) {
      for (const { artist: performer, role } of performers) {
        // Stories name the best-known: the sampled artist or the one sampling them.
        if (performer === sampled || !(rank.has(performer) || rank.has(sampled))) continue;
        const own = uses.get(sampled) ?? new Map<string, Use>();
        own.set(`${performer}:${at}`, {
          performer,
          song: at,
          year: song.year,
          evidence: {
            kind: "sampled",
            a: sampled,
            b: performer,
            aRole: "sampled",
            bRole: role,
            detail: "",
            subject: { type: "song", at },
            year: song.year,
          },
        });
        uses.set(sampled, own);
      }
    }
  });
  const stories: Candidate[] = [];
  for (const [sampled, own] of [...uses].sort(([x], [y]) => x - y)) {
    const list = [...own.values()].sort(
      (x, y) => (x.year ?? 9999) - (y.year ?? 9999) || x.performer - y.performer || x.song - y.song,
    );
    const dated = list.filter((u) => u.year !== null);
    let pair: [Use, Use] | null = null;
    for (const [x, y] of pairsOf(dated)) {
      if (x.performer !== y.performer && y.year! - x.year! >= MIN_SAMPLE_GAP) {
        pair = [x, y];
        break;
      }
    }
    if (pair) {
      const [x, y] = pair;
      stories.push({
        kind: "same-sample",
        artists: [x.performer, y.performer, sampled],
        text: `${name(x.performer)} sampled ${name(sampled)} in ${x.year}; ${y.year! - x.year!} years later, ${name(y.performer)} did too.`,
        evidence: [x.evidence, y.evidence],
        pair: [x.performer, y.performer],
        score: 10 + y.year! - x.year!,
      });
    } else {
      const [first] = list;
      stories.push({
        kind: "sampled",
        artists: [first.performer, sampled],
        text: `“${c.songs[first.song].title}” by ${name(first.performer)} samples ${name(sampled)}.`,
        evidence: [first.evidence],
        pair: null,
        score: -Math.min(rank.get(first.performer) ?? POPULAR, rank.get(sampled) ?? POPULAR),
      });
    }
  }
  return stories;
}

/** A number from a text, to seed the shuffle. */
function hashOf(text: string): number {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A fixed shuffle (mulberry32): the same seed always gives the same order. */
export function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function toStory(c: Catalog, s: Candidate): Story {
  const ref = (at: number) => artistRef(c, at);
  return {
    id: `${s.kind}:${s.artists.map((at) => c.artists[at].id).join("+")}`,
    kind: s.kind,
    title: STORY_TITLES[s.kind],
    text: s.text,
    artists: s.artists.map(ref),
    reasons: s.evidence.slice(0, MAX_REASONS).map((e) => reasonOf(c, e)),
    pair: s.pair && [ref(s.pair[0]), ref(s.pair[1])],
  };
}

/** Every story in the graph: the best of each kind, mixed so no kind clusters. */
export function findStories(g: Graph): Story[] {
  const c = g.catalog;
  const popular = knownArtists(c).slice(0, POPULAR);
  const ctx: Context = {
    g,
    c,
    rank: new Map(popular.map((a, i) => [a, i])),
    name: (at) => c.artists[at].name,
    linked: (a, b, categories = DEFAULT_CATEGORIES) => {
      const edge = g.edges[a].get(b);
      return edge !== undefined && strengthOf(edge, categories) > 0;
    },
  };
  const seed = hashOf(`stories:${c.artists.length}:${c.songs.length}:${c.releases.length}`);
  const kinds = [
    sharedProducer(ctx),
    twoSteps(ctx, popular),
    sessionPlayers(ctx, popular),
    labelMates(ctx, popular),
    samples(ctx),
  ].map((found) => {
    const picked: Candidate[] = [];
    const leads = new Set<string>();
    for (const story of found.sort((x, y) => y.score - x.score || x.artists[0] - y.artists[0])) {
      // One story per lead artist within a kind, so the feed moves around.
      const lead = `${story.kind}:${story.artists[0]}`;
      if (leads.has(lead)) continue;
      leads.add(lead);
      picked.push(story);
      if (picked.length === MAX_PER_KIND) break;
    }
    return shuffled(picked, seed);
  });
  const feed: Story[] = [];
  const longest = Math.max(...kinds.map((k) => k.length));
  for (let i = 0; i < longest; i++) for (const kind of kinds) if (kind[i]) feed.push(toStory(c, kind[i]));
  return feed;
}

const cached = new WeakMap<Graph, Story[]>();

/** The graph's stories, found once per server instance. */
export function stories(g: Graph): Story[] {
  let found = cached.get(g);
  if (!found) cached.set(g, (found = findStories(g)));
  return found;
}

/** The story for a day: every story in turn, one a day, the same for everyone. */
export function storyOfDay(all: Story[], day: number): number {
  return ((day % all.length) + all.length) % all.length;
}

/** The story an address asks for, counting from 1; anything else is the first. */
export function storyNumber(value: string, total: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= total ? n : 1;
}

