// Browser-side client for our own Next.js API routes. The page never calls MusicBrainz or
// Deezer directly; the routes handle rate limits, retries and server caching.
import type { Artist, ArtistDetails, CollaboratorComparison, RecordingDetails, Song, TopTrack } from '@/lib/types';

export class ApiError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'ApiError';
    this.retryable = retryable;
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach Song Nexus. Check your connection and try again.', true);
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string; retryable?: boolean };
  if (!response.ok) throw new ApiError(body.error || `Request failed (${response.status}).`, Boolean(body.retryable) || response.status >= 500);
  return body as T;
}

// Lookups are shared between cards, the graph and the drawer, so each id is fetched once per page
// load. Failed requests are dropped from the memo so "Try again" really retries.
const memo = new Map<string, Promise<unknown>>();
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit) return hit as Promise<T>;
  const promise = load();
  memo.set(key, promise);
  promise.catch(() => memo.delete(key));
  return promise;
}

const SEARCH_LIMIT = 24;
const search = <T>(type: 'artist' | 'recording', query: string, signal?: AbortSignal, limit = SEARCH_LIMIT) =>
  getJson<{ results: T[] }>(`/api/musicbrainz/search?type=${type}&limit=${limit}&q=${encodeURIComponent(query)}`, signal).then(r => r.results);

export const searchArtists = (query: string, signal?: AbortSignal, limit?: number) => search<Artist>('artist', query, signal, limit);
export const searchSongs = (query: string, signal?: AbortSignal, limit?: number) => search<Song>('recording', query, signal, limit);

export const artistDetails = (id: string) =>
  once(`artist:${id}`, () => getJson<{ details: ArtistDetails }>(`/api/musicbrainz/details?type=artist&id=${id}`).then(r => r.details));

export const songDetails = (id: string) =>
  once(`song:${id}`, () => getJson<{ details: RecordingDetails }>(`/api/musicbrainz/details?type=recording&id=${id}`).then(r => r.details));

/** Collaborators shared by two artists. A first scan of two big catalogues takes ~10 s. */
export const collaborators = (a: string, b: string) =>
  once(`collab:${a}:${b}`, () => getJson<{ collaborators: CollaboratorComparison }>(`/api/musicbrainz/collaborators?a=${a}&b=${b}`).then(r => r.collaborators));

/** The artist's most popular song (ranked by Deezer) as a MusicBrainz recording, or null. */
export const topTrack = (id: string, name: string) =>
  once(`top:${id}`, () => getJson<{ track: TopTrack | null }>(`/api/top-track?id=${id}&name=${encodeURIComponent(name)}`).then(r => r.track));
