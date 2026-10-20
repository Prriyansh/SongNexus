// Shared domain types + pure helpers used by both the API layer and the UI.
// Keeping these in one place avoids the frontend and the route drifting apart.

export type Mode = "songs" | "artists";

export type Artist = {
  id: string;
  name: string;
  disambiguation: string;
  country: string;
  type: string;
  tags: string[];
  lifeSpan: { begin?: string; end?: string; ended?: boolean };
};

export type Song = {
  id: string;
  title: string;
  durationMs: number | null;
  disambiguation: string;
  artists: { name: string; id: string | null }[];
  tags: string[];
  releases: { id: string; title: string; date: string }[];
};

export type Result = Song | Artist;

/** Narrows a Result to a Song. Songs have a `title`; artists have a `name`. */
export function isSong(result: Result): result is Song {
  return "title" in result;
}

/** Formats a MusicBrainz duration (ms) as m:ss, or a clear fallback when absent. */
export function formatDuration(ms: number | null): string {
  if (ms == null) return "Not available";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Tags present on both results, preserving the order of the first. */
export function sharedTags(first: Result, second: Result): string[] {
  const secondSet = new Set(second.tags);
  return first.tags.filter((tag) => secondSet.has(tag));
}
