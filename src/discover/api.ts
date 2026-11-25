// The only place Discover's browser code calls the server.
import type { Category, EntityRef, GraphData, Reason } from "./lib/types";

async function getJson<T>(
  path: string,
  params: Record<string, string>,
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
