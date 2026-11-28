// Each day's leaderboard per game: one entry per player, lower scores first and, on a tie, whoever
// finished first. Players are random IDs their browser keeps; only the name they chose is shown.
// Server only.
import { DAY_MS } from "./days";
import type { Game } from "./game-info";
import type { Store } from "./store";

/** Boards are kept this long, so the archive's recent days still have theirs. */
export const BOARD_DAYS = 35;
const TTL = BOARD_DAYS * 86_400;
export const SHOWN = 10;

const boardKey = (game: Game, day: number) => `board:${game}:${day}`;
const nameKey = (game: Game, day: number, player: string) => `board:${game}:${day}:name:${player}`;

/** A name to show: 2–24 letters, digits, spaces and . - ' _; nothing that reads as a link. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 24 || !/^[\p{L}\p{N} .'_-]+$/u.test(name)) return null;
  return /https?|www\.|\.(com|net|org|io)\b/i.test(name) ? null : name;
}

export type Board = { entries: { name: string; score: number }[]; total: number; mine: number | null };

/**
 * Adds a player's score once. The fraction (the time into the day, under 0.09) keeps ties in the
 * order people finished.
 */
export async function submitScore(
  store: Store,
  game: Game,
  day: number,
  player: string,
  name: string,
  score: number,
  now: number,
): Promise<{ added: boolean; place: number; total: number }> {
  const key = boardKey(game, day);
  const added = await store.rankNew(key, player, score + (now - day * DAY_MS) / 1e9, TTL);
  if (added) await store.set(nameKey(game, day, player), name, TTL);
  const [place, total] = await Promise.all([store.place(key, player), store.size(key)]);
  return { added, place: place!, total };
}

export async function readBoard(store: Store, game: Game, day: number, player: string | null): Promise<Board> {
  const key = boardKey(game, day);
  const top = await store.top(key, SHOWN);
  const names = await Promise.all(top.map(([member]) => store.get(nameKey(game, day, member))));
  const [total, mine] = await Promise.all([store.size(key), player ? store.place(key, player) : null]);
  return {
    entries: top.map(([, score], i) => ({ name: names[i] ?? "Someone", score: Math.floor(score) })),
    total,
    mine,
  };
}
