// The only place Discover's browser code calls the server.
import type { ArtistRef, Category, EntityRef, ForYouPick, GraphData, Reason } from "./lib/types";

async function getJson<T>(
  path: string,
  params: Record<string, string> | URLSearchParams,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/discover/${path}?${new URLSearchParams(params)}`, { signal });
  if (!response.ok) {
    // Discover's routes say what went wrong in words meant for the reader.
    const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof data?.error === "string" ? data.error : `Discover ${path} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function search(q: string, kinds: string, signal?: AbortSignal): Promise<EntityRef[]> {
  return (await getJson<{ results: EntityRef[] }>("search", { q, kinds }, signal)).results;
}

export function neighborhood(
  artist: string,
  categories: readonly Category[],
  limit: number,
  signal?: AbortSignal,
): Promise<GraphData> {
  return getJson<GraphData>(
    "neighborhood",
    { artist, categories: categories.join(","), limit: String(limit) },
    signal,
  );
}

export function reasons(
  a: string,
  b: string,
  categories: readonly Category[],
  signal?: AbortSignal,
): Promise<{ reasons: Reason[]; total: number }> {
  return getJson("reasons", { a, b, categories: categories.join(",") }, signal);
}

export type TodayStory = { n: number; title: string; text: string; artists: ArtistRef[] };

export function today(signal?: AbortSignal): Promise<{ day: number; story: TodayStory | null }> {
  return getJson("today", {}, signal);
}

/** Picks for the favourites (artist IDs and genre names) and without the hidden artists. */
export function forYou(
  favourites: { artists: string[]; genres: string[] },
  hidden: string[],
  signal?: AbortSignal,
): Promise<{ picks: ForYouPick[]; known: { artists: number; genres: number } }> {
  return getJson("for-you", forYouQuery(favourites, hidden), signal);
}

export function forYouQuery(favourites: { artists: string[]; genres: string[] }, hidden: string[]) {
  const params = new URLSearchParams({ artists: favourites.artists.join(",") });
  favourites.genres.forEach((genre) => params.append("genre", genre));
  if (hidden.length) params.set("hidden", hidden.join(","));
  return params;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/discover/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Discover ${path} failed (${response.status})`);
  return data;
}

export const step = (day: number, from: string, guess: string) =>
  postJson<{ linked: boolean; reason: Reason | null; reached: boolean }>("games/step", { day, from, guess });

export const checkAnswer = (game: string, day: number, question: number, choice: string) =>
  postJson<{ correct: boolean; answer: ArtistRef; proof: Reason[] }>("games/answer", { game, day, question, choice });

export type Board = { entries: { name: string; score: number }[]; total: number; mine: number | null };

export const submitScore = (game: string, day: number, player: string, name: string, answers: string[]) =>
  postJson<{ score: number; added: boolean; place: number; total: number }>("games/score", { game, day, player, name, answers });

export const board = (game: string, day: number, player: string | null, signal?: AbortSignal) =>
  getJson<Board>("games/board", { game, day: String(day), ...(player ? { player } : {}) }, signal);

export type Listened = { name: string; plays: number | null; artist: ArtistRef | null };

export const listening = (service: string, user: string, signal?: AbortSignal) =>
  getJson<{ artists: Listened[] }>("listening", { service, user }, signal);

export type Between = { artist: ArtistRef; with: ArtistRef[] };
export type Nexus = { artists: ArtistRef[]; linked: { a: ArtistRef; b: ArtistRef; reason: Reason }[]; between: Between[] };
export type FriendPaths = {
  shared: ArtistRef[];
  paths: { artists: ArtistRef[]; reasons: Reason[] }[];
  between: Between[];
};

export const nexus = (artists: string[], signal?: AbortSignal) =>
  getJson<Nexus>("nexus", { artists: artists.join(",") }, signal);

export const friendPaths = (mine: string[], theirs: string[], signal?: AbortSignal) =>
  getJson<FriendPaths>("nexus", { artists: mine.join(","), theirs: theirs.join(",") }, signal);
