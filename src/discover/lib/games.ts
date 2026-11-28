// The daily games, made from the catalog with a fixed shuffle so each day's are the same for
// everyone. Answers are checked here, so the answer key never reaches the browser. Server only.
import { knownArtists } from "./browse";
import type { Credit } from "./catalog";
import { MAX_CHAIN, QUESTIONS, type Game, type Puzzle, type Quiz, type QuizQuestion } from "./game-info";
import { evidenceBetween, neighbors, strengthOf, type Evidence, type Graph } from "./graph";
import { findPath } from "./paths";
import { hashOf, shuffled } from "./random";
import { DEFAULT_CATEGORIES, type ArtistRef, type Reason } from "./types";
import { artistRef, partName, reasonOf, songRef } from "./words";

/** The games are about the best-known artists. */
export const POOL = 150;
/** A Connect puzzle's shortest path takes this many steps, at least and at most. */
export const MIN_PAR = 3;
export const MAX_PAR = 4;


const linked = (g: Graph, a: number, b: number) => {
  const edge = g.edges[a].get(b);
  return edge !== undefined && strengthOf(edge, DEFAULT_CATEGORIES) > 0;
};

/** The day's Connect: two well-known artists three or four steps apart, or null if none are. */
export function puzzleOf(g: Graph, day: number): Puzzle | null {
  const c = g.catalog;
  const order = shuffled(knownArtists(c).slice(0, POOL), hashOf(`connect:${day}`));
  for (let i = 0; i + 1 < order.length; i += 2) {
    const path = findPath(g, order[i], order[i + 1], { categories: DEFAULT_CATEGORIES, maxSteps: MAX_PAR });
    if (path && path.length - 1 >= MIN_PAR)
      return { start: artistRef(c, order[i]), target: artistRef(c, order[i + 1]), par: path.length - 1 };
  }
  return null;
}

/** The strongest credit between two artists, if they worked together. */
export function linkReason(g: Graph, from: number, to: number): Reason | null {
  const [e] = evidenceBetween(g.catalog, from, to, DEFAULT_CATEGORIES);
  return e ? reasonOf(g.catalog, e) : null;
}

/** The steps a chain of artist IDs takes from the start to the target, or null if it isn't one. */
export function chainSteps(g: Graph, puzzle: Puzzle, chain: readonly string[]): number | null {
  const at = chain.map((id) => g.catalog.artistAt.get(id));
  if (chain.length < 2 || chain.length - 1 > MAX_CHAIN || at.includes(undefined)) return null;
  if (chain[0] !== puzzle.start.id || chain[chain.length - 1] !== puzzle.target.id) return null;
  for (let i = 1; i < at.length; i++) if (!linked(g, at[i - 1]!, at[i]!)) return null;
  return chain.length - 1;
}

// --- Quizzes ------------------------------------------------------------------------------------

type Key = QuizQuestion & { answer: string; proof: Reason[] };

const CREDIT_KINDS = ["producer", "featured", "instrument"] as const;
type CreditKind = (typeof CREDIT_KINDS)[number];
const asks = (kind: CreditKind, credit: Credit) =>
  credit.role === kind && (kind !== "instrument" || credit.detail !== "");

function creditKeys(g: Graph, day: number): Key[] {
  const c = g.catalog;
  const popular = knownArtists(c).slice(0, POOL);
  const songs = [...new Set(popular.flatMap((a) => c.songsOf[a].filter((s) => c.songs[s].primary.includes(a))))];
  // Wrong answers are people credited the same way elsewhere, whom people listen to.
  const pools: Record<CreditKind, Set<number>> = { producer: new Set(), featured: new Set(), instrument: new Set() };
  for (const s of songs)
    for (const credit of c.songs[s].credits)
      for (const kind of CREDIT_KINDS)
        if (asks(kind, credit) && c.artists[credit.artist].listeners !== null) pools[kind].add(credit.artist);
  const keys: Key[] = [];
  for (const at of shuffled(songs, hashOf(`credits:${day}`))) {
    if (keys.length === QUESTIONS.credits) break;
    const kind = CREDIT_KINDS[keys.length % CREDIT_KINDS.length];
    const song = c.songs[at];
    const answer = song.credits.find((x) => asks(kind, x) && !song.primary.includes(x.artist));
    if (!answer) continue;
    const credited = new Set(song.credits.map((x) => x.artist));
    const wrong = shuffled([...pools[kind]].filter((a) => !credited.has(a)), hashOf(`credits:${day}:${at}`));
    if (wrong.length < 3) continue;
    const by = song.primary.map((a) => c.artists[a].name).join(" and ");
    const [lead] = song.primary;
    const subject = { type: "song" as const, at };
    const proof: Evidence =
      kind === "featured"
        ? { kind: "performed_with", a: lead, b: answer.artist, aRole: "primary", bRole: "featured", detail: "", subject, year: song.year }
        : kind === "producer"
          ? { kind: "produced_for", a: answer.artist, b: lead, aRole: "producer", bRole: "primary", detail: "", subject, year: song.year }
          : { kind: "contributed_to", a: answer.artist, b: lead, aRole: "instrument", bRole: "primary", detail: answer.detail, subject, year: song.year };
    const text = {
      producer: `Who produced “${song.title}” by ${by}?`,
      featured: `Who is featured on “${song.title}” by ${by}?`,
      instrument: `Who is credited with ${partName("instrument", answer.detail)} on “${song.title}” by ${by}?`,
    }[kind];
    keys.push({
      text,
      song: songRef(c, at),
      options: shuffled([answer.artist, ...wrong.slice(0, 3)], hashOf(`options:${day}:${at}`)).map((a) => artistRef(c, a)),
      answer: c.artists[answer.artist].id,
      proof: [reasonOf(c, proof)],
    });
  }
  return keys;
}

function linkKeys(g: Graph, day: number): Key[] {
  const c = g.catalog;
  const order = shuffled(knownArtists(c).slice(0, POOL), hashOf(`link:${day}`));
  const near = (a: number) =>
    new Map(neighbors(g, a, DEFAULT_CATEGORIES).map((n) => [n.artist, n.strength] as const));
  const keys: Key[] = [];
  for (let i = 0; i + 1 < order.length && keys.length < QUESTIONS.link; i += 2) {
    const [a, b] = [order[i], order[i + 1]];
    if (linked(g, a, b)) continue;
    const [nearA, nearB] = [near(a), near(b)];
    const common = [...nearA]
      .filter(([other]) => nearB.has(other))
      .sort(([x, p], [y, q]) => Math.min(q, nearB.get(y)!) - Math.min(p, nearB.get(x)!) || x - y);
    if (!common.length) continue;
    const via = common[0][0];
    // Wrong answers worked with one of the two only, so exactly one option is right.
    const onlyOne = [...nearA.keys(), ...nearB.keys()].filter(
      (other) => !(nearA.has(other) && nearB.has(other)) && other !== a && other !== b,
    );
    const wrong = shuffled([...new Set(onlyOne)], hashOf(`link:${day}:${a}:${b}`));
    if (wrong.length < 3) continue;
    const [first, second] = [linkReason(g, a, via)!, linkReason(g, via, b)!];
    keys.push({
      text: `Who has worked with both ${c.artists[a].name} and ${c.artists[b].name}?`,
      song: null,
      options: shuffled([via, ...wrong.slice(0, 3)], hashOf(`options:${day}:${a}:${b}`)).map((x) => artistRef(c, x)),
      answer: c.artists[via].id,
      proof: [first, second],
    });
  }
  return keys;
}

/** Quizzes made lately, per graph: the archive's days stay quick without keeping every day. */
const made = new WeakMap<Graph, Map<string, Key[]>>();
export const MADE_KEPT = 64;

function keysOf(g: Graph, quiz: Quiz, day: number): Key[] {
  const kept = made.get(g) ?? new Map<string, Key[]>();
  made.set(g, kept);
  const id = `${quiz}:${day}`;
  let keys = kept.get(id);
  if (!keys) {
    keys = quiz === "credits" ? creditKeys(g, day) : linkKeys(g, day);
    if (kept.size >= MADE_KEPT) kept.delete(kept.keys().next().value!);
    kept.set(id, keys);
  }
  return keys;
}

/** The day's questions, without their answers. */
export function quizOf(g: Graph, quiz: Quiz, day: number): QuizQuestion[] {
  return keysOf(g, quiz, day).map(({ text, song, options }) => ({ text, song, options }));
}

export type Checked = { correct: boolean; answer: ArtistRef; proof: Reason[] };

/** Whether `choice` (an artist ID) answers a question; null for a question that doesn't exist. */
export function checkAnswer(g: Graph, quiz: Quiz, day: number, question: number, choice: string): Checked | null {
  const key = keysOf(g, quiz, day)[question];
  if (!key) return null;
  return { correct: key.answer === choice, answer: key.options.find((o) => o.id === key.answer)!, proof: key.proof };
}

/** Misses over a whole quiz (lower is better), or null unless every question has an answer. */
export function quizMisses(g: Graph, quiz: Quiz, day: number, choices: readonly string[]): number | null {
  const keys = keysOf(g, quiz, day);
  if (!keys.length || choices.length !== keys.length) return null;
  return keys.filter((key, i) => key.answer !== choices[i]).length;
}

/** A game's score from its answers: steps for Connect, misses for a quiz; null if they don't add up. */
export function scoreOf(g: Graph, game: Game, day: number, answers: readonly string[]): number | null {
  if (game !== "connect") return quizMisses(g, game, day, answers);
  const puzzle = puzzleOf(g, day);
  return puzzle && chainSteps(g, puzzle, answers);
}
