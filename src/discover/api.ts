// The only place Discover's browser code calls the server.
import type { ArtistRef, Category, EntityRef, ForYouPick, GraphData, Reason } from "./lib/types";

async function getJson<T>(
  path: string,
  params: Record<string, string> | URLSearchParams,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/discover/${path}?${new URLSearchParams(params)}`, { signal });
  if (!response.ok) throw new Error(`Discover ${path} failed (${response.status})`);
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
