// The daily games as the browser knows them: names, rules, and the results kept in this browser.
// Safe to import from client components.
import type { ArtistRef, EntityRef } from "./types";

export const GAMES = ["connect", "credits", "link"] as const;
export type Game = (typeof GAMES)[number];
export const isGame = (value: string): value is Game => (GAMES as readonly string[]).includes(value);

export const GAME_INFO: Record<Game, { name: string; rule: string }> = {
  connect: {
    name: "Connect",
    rule: "Get from one artist to another through people who worked together, in as few steps as you can.",
  },
  credits: {
    name: "Credit check",
    rule: "Five questions about who made what, each answered with the credit that proves it.",
  },
  link: {
    name: "The missing link",
    rule: "Three pairs of artists with no credit together: pick the one person who worked with both.",
  },
};

/** Questions in each quiz. */
export const QUESTIONS = { credits: 5, link: 3 } as const;
export type Quiz = keyof typeof QUESTIONS;

/** A Connect chain can't be longer than this. */
export const MAX_CHAIN = 8;

export type Puzzle = { start: ArtistRef; target: ArtistRef; par: number };
export type QuizQuestion = { text: string; song: EntityRef | null; options: ArtistRef[] };

export const gameHref = (game: Game, day?: string) =>
  day ? `/discover/games/${game}?day=${day}` : `/discover/games/${game}`;

/** How a score reads: steps for Connect (fewer is better), right answers for the quizzes. */
export function scoreText(game: Game, score: number): string {
  if (game === "connect") return `${score} ${score === 1 ? "step" : "steps"}`;
  return `${QUESTIONS[game] - score} of ${QUESTIONS[game]}`;
}

// --- Results kept in this browser -------------------------------------------------------------

export const GAMES_KEY = "song-nexus-games";
export const PLAYER_KEY = "song-nexus-player";

/**
 * One finished game. `score` is what the leaderboard ranks, lower first: steps for Connect, misses
 * for the quizzes. `gaveUp` is a Connect left unfinished. `answers` (the chain, or the choices)
 * are kept so the score can go on the leaderboard later.
 */
export type GameResult = { score: number; gaveUp: boolean; submitted: boolean; answers: string[] };
export type GameResults = Record<Game, Record<string, GameResult>>;

const empty = (): GameResults => ({ connect: {}, credits: {}, link: {} });

export function resultsIn(raw: string | null): GameResults {
  const results = empty();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  for (const game of GAMES) {
    const days = (parsed as Record<string, unknown> | null)?.[game];
    if (!days || typeof days !== "object") continue;
    for (const [day, value] of Object.entries(days as Record<string, unknown>)) {
      const score = (value as GameResult | null)?.score;
      if (!/^\d+$/.test(day) || !Number.isInteger(score) || score! < 0) continue;
      const { gaveUp, submitted, answers } = value as GameResult;
      results[game][day] = {
        score: score!,
        gaveUp: gaveUp === true,
        submitted: submitted === true,
        answers: Array.isArray(answers) ? answers.filter((a) => typeof a === "string").slice(0, MAX_CHAIN + 1) : [],
      };
    }
  }
  return results;
}

export function withResult(raw: string | null, game: Game, day: number, result: GameResult): GameResults {
  const results = resultsIn(raw);
  results[game][String(day)] = result;
  return results;
}

/** Days in a row with a finished game, up to today (or yesterday, before today's is played). */
export function streakOf(results: GameResults, today: number): number {
  const played = (day: number) => GAMES.some((game) => results[game][String(day)]);
  let day = played(today) ? today : today - 1;
  let streak = 0;
  while (played(day)) {
    streak++;
    day--;
  }
  return streak;
}

export function statsOf(results: GameResults) {
  const days = new Set(GAMES.flatMap((game) => Object.keys(results[game])));
  const wins = Object.values(results.connect).filter((r) => !r.gaveUp).length;
  const perfect = (["credits", "link"] as const).reduce(
    (sum, game) => sum + Object.values(results[game]).filter((r) => r.score === 0).length,
    0,
  );
  return { days: days.size, wins, perfect };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPlayer = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** The player ID this browser keeps, if it has a valid one. */
export function storedPlayer(raw: string | null): string | null {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    return isPlayer(value) ? value : null;
  } catch {
    return null;
  }
}
