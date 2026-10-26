// Sound & lyrics data for a song comparison, from the song_compare service (Ishita's Python
// API: Spotify audio features + Genius lyric analysis). Explore knows songs by MusicBrainz id;
// the service knows them by Spotify id, so songs are matched by title and artist first.

export type AudioFeature =
  | "tempo" | "energy" | "danceability" | "valence" | "acousticness"
  | "loudness" | "speechiness" | "instrumentalness" | "liveness";

export type LyricFeatures = {
  sentiment: { compound: number; positive_share: number; negative_share: number };
  emotions: Record<string, number>;
  top_emotion: string;
  themes: Record<string, number>;
  top_themes: string[];
  structure: {
    verses: number; choruses: number; bridges: number; has_intro: boolean; has_outro: boolean;
    sections_total: number; lines: number; words: number; repetition: number; lexical_diversity: number;
  };
};

/** A song as the service's search/similar endpoints describe it. */
export type SoundTrackBrief = {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  genre: string | null;
  has_lyrics: boolean;
};

export type SoundTrack = SoundTrackBrief & {
  popularity: number;
  duration_ms: number;
  explicit: boolean;
  tempo: number;
  key: number | null;
  mode: number;
  key_name: string;
  time_signature: number | null;
  audio: Record<AudioFeature, number>;
  lyrics: LyricFeatures | null;
};

export type SoundComparison = {
  a: SoundTrack;
  b: SoundTrack;
  /** 0–1: audio and lyric similarity blended (audio only when lyrics are missing). */
  overall: number;
  audio: { score: number; distance: number; per_feature: Record<AudioFeature, number> };
  lyrics: {
    score: number; semantic: number; vocabulary: number; themes: number; sentiment: number;
    shared_themes: string[]; emotion_a: string; emotion_b: string;
  } | null;
  credits: { artists: string[]; same_album: boolean; same_genre: boolean; genre: string | null; album: string | null };
  structure: {
    tempo: { a: number; b: number; half_double_match: boolean };
    key: { a: string; b: string; relation: string };
    time_signature: { a: number | null; b: number | null };
    duration_sec: { a: number; b: number };
  };
  reasons: string[];
};

export type SimilarSong = SoundTrackBrief & { score: number; shares_artist: boolean };

export type SoundResult =
  | { status: "ok"; comparison: SoundComparison; similar: { a: SimilarSong[]; b: SimilarSong[] } }
  /** One or both songs aren't in the dataset (a 2022 snapshot of ~76k Spotify tracks). */
  | { status: "not-found"; missing: ("a" | "b")[] }
  /** Both names match the same dataset track (e.g. a remaster and the original). */
  | { status: "same-track" }
  /** The service isn't configured or didn't answer. */
  | { status: "unavailable"; hint?: string };

export type SongName = { title: string; artist: string };

const DEV_URL = "http://localhost:5050";
const TIMEOUT_MS = 8_000;
const SIMILAR_PER_SONG = 4;

/** The service's base URL: SONG_COMPARE_URL, or its default local port in development. */
export function songCompareUrl(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.SONG_COMPARE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return env.NODE_ENV === "development" ? DEV_URL : null;
}

class Unavailable extends Error {}
class SameTrack extends Error {}

export type SoundOptions = { baseUrl?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number };

/** Matches both songs in the dataset, compares them, and finds songs that sound like each. */
export async function compareSound(a: SongName, b: SongName, options: SoundOptions = {}): Promise<SoundResult> {
  const baseUrl = options.baseUrl === undefined ? songCompareUrl() : options.baseUrl;
  if (!baseUrl) return { status: "unavailable" };
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  // null for a 404 ("not in the dataset"); throws Unavailable for anything else that went wrong.
  const get = async <T>(path: string): Promise<T | null> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new Unavailable();
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 400 && body.error === "Pick two different songs.") throw new SameTrack();
      throw new Unavailable();
    }
    return (await response.json()) as T;
  };
  const query = (song: SongName) => `title=${encodeURIComponent(song.title)}&artist=${encodeURIComponent(song.artist)}`;

  try {
    const [ma, mb] = await Promise.all([
      get<{ track: SoundTrackBrief }>(`/api/match?${query(a)}`),
      get<{ track: SoundTrackBrief }>(`/api/match?${query(b)}`),
    ]);
    const missing = ([["a", ma], ["b", mb]] as const).filter(([, m]) => !m).map(([side]) => side);
    if (missing.length || !ma || !mb) return { status: "not-found", missing };
    if (ma.track.id === mb.track.id) return { status: "same-track" };

    const ids = [ma.track.id, mb.track.id].map(encodeURIComponent);
    const [comparison, simA, simB] = await Promise.all([
      get<SoundComparison>(`/api/compare?a=${ids[0]}&b=${ids[1]}`),
      get<{ results: SimilarSong[] }>(`/api/similar/${ids[0]}?k=${SIMILAR_PER_SONG}`),
      get<{ results: SimilarSong[] }>(`/api/similar/${ids[1]}?k=${SIMILAR_PER_SONG}`),
    ]);
    if (!comparison) throw new Unavailable();
    return { status: "ok", comparison, similar: { a: simA?.results ?? [], b: simB?.results ?? [] } };
  } catch (error) {
    if (error instanceof SameTrack) return { status: "same-track" };
    if (error instanceof Unavailable) return { status: "unavailable" };
    throw error;
  }
}

export type SoundSearch = { status: "ok"; results: SoundTrackBrief[] } | { status: "unavailable" };

/** Searches the sound dataset by title or artist, so pickers offer songs that have the full analysis. */
export async function searchSound(query: string, limit = 10, options: SoundOptions = {}): Promise<SoundSearch> {
  const baseUrl = options.baseUrl === undefined ? songCompareUrl() : options.baseUrl;
  if (!baseUrl) return { status: "unavailable" };
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      { signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS) }
    );
    if (!response.ok) return { status: "unavailable" };
    const body = (await response.json()) as { results?: SoundTrackBrief[] };
    return { status: "ok", results: Array.isArray(body.results) ? body.results : [] };
  } catch {
    return { status: "unavailable" };
  }
}

