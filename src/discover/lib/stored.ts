// What this browser keeps for Discover: About Me's favourites (written by the app), the artists
// opened lately and the artists hidden from suggestions. Storage can be missing, full or edited by
// hand, so everything read is checked. Safe to import from client components.

export const PROFILE_KEY = "song-nexus-profile";
export const RECENT_KEY = "song-nexus-recent";
export const HIDDEN_KEY = "song-nexus-hidden";
/** Told to this tab's readers when it writes, as the browser tells other tabs with "storage". */
const CHANGED = "song-nexus-storage";
export const MAX_RECENT = 12;
export const MAX_HIDDEN = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const text = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");

function parse(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const fieldOf = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

export type Favourites = { artists: string[]; genres: string[] };

/** About Me's favourite artists (and the artists of favourite songs and albums) and genres. */
export function favouritesIn(raw: string | null): Favourites {
  const profile = parse(raw);
  const artists = [
    ...listOf(fieldOf(profile, "artists")).map((a) => fieldOf(a, "id")),
    ...listOf(fieldOf(profile, "songs")).map((s) => fieldOf(s, "artistId")),
    ...listOf(fieldOf(profile, "albums")).map((a) => fieldOf(a, "artistId")),
  ].filter(isId);
  const genres = listOf(fieldOf(profile, "genres"))
    .map((g) => text(g, 60).trim())
    .filter(Boolean);
  return { artists: [...new Set(artists.map((id) => id.toLowerCase()))], genres: [...new Set(genres)] };
}

export type Visit = { id: string; name: string; note: string; photo: string | null };

const photoOf = (value: unknown) =>
  typeof value === "string" && value.startsWith("https://upload.wikimedia.org/") ? value : null;

/** A stored list of artists, each once, at most `max`. */
export function artistsIn(raw: string | null, max: number): Visit[] {
  const seen = new Set<string>();
  return listOf(parse(raw))
    .map((v) => ({
      id: fieldOf(v, "id"),
      name: text(fieldOf(v, "name")),
      note: text(fieldOf(v, "note")),
      photo: photoOf(fieldOf(v, "photo")),
    }))
    .filter((v): v is Visit => isId(v.id) && v.name !== "" && !seen.has(v.id) && !!seen.add(v.id))
    .slice(0, max);
}

/** The artists opened lately, the latest first. */
export const recentIn = (raw: string | null) => artistsIn(raw, MAX_RECENT);

/** The list with this visit first, once. */
export function withVisit(raw: string | null, visit: Visit): Visit[] {
  return [visit, ...recentIn(raw).filter((v) => v.id !== visit.id)].slice(0, MAX_RECENT);
}

/** The artists hidden from suggestions. */
export const hiddenArtistsIn = (raw: string | null) => artistsIn(raw, MAX_HIDDEN);
export const hiddenIn = (raw: string | null) => hiddenArtistsIn(raw).map((v) => v.id);

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Saves a value (or removes it, for null) and tells this tab's readers. */
export function writeStored(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage only loses a convenience.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function subscribeStored(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}
