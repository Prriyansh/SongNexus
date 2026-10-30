// Browser-side client for our own Next.js API routes. The page never calls MusicBrainz or
// Deezer directly; the routes handle rate limits, retries and server caching.
import type { Artist, ArtistDetails, ArtistNeighborhood, CollaboratorComparison, RecordingDetails, Song, TopTrack } from '@/lib/types';
import type { SoundResult, SoundSearch } from '@/lib/sound';
import type { DiscoveryArtist } from './connection-web';

export class ApiError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'ApiError';
    this.retryable = retryable;
  }
}

/** MusicBrainz sometimes answers "busy"; retryable errors get one more try before the user sees them. */
export const retryPolicy = { delayMs: 1500 };

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  try {
    return await getJsonOnce<T>(url, signal);
  } catch (error) {
    if (!(error instanceof ApiError) || !error.retryable || signal?.aborted) throw error;
    await new Promise(resolve => setTimeout(resolve, retryPolicy.delayMs));
    if (signal?.aborted) throw error;
    return getJsonOnce<T>(url, signal);
  }
}

async function getJsonOnce<T>(url: string, signal?: AbortSignal): Promise<T> {
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

/** A bounded search per style, preserving partial results when one neighborhood fails. */
export function discoverWebArtists(journey: string[], focus: string[][] = []) {
  const key = `web:${JSON.stringify([journey, focus])}`;
  return once(key, async () => {
    const results = await Promise.allSettled(journey.map(genre => {
      const secondary = focus.find(tags => tags.includes(genre))?.find(tag => tag !== genre);
      const query = [genre, ...(secondary ? [secondary] : [])].map(tag => `tag:"${tag.replace(/["\\]/g, '')}"`).join(' AND ');
      return once(`web-query:${query}`, () => searchArtists(query, undefined, 16)
        .then(artists => artists.filter(artist => !artist.tags.some(tag => tag.toLowerCase().includes('special purpose')) && !/^(various artists|\[unknown\]|\[no artist\])$/i.test(artist.name))
          .map(artist => ({ ...artist, neighborhood: genre } as DiscoveryArtist))));
    }));
    const failed = results.flatMap((r, i) => r.status === 'rejected' ? [journey[i]] : []);
    const artists = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    // Partial failures must be retried by the explicit retry button, rather than cached forever.
    if (failed.length) memo.delete(key);
    return { artists, failed };
  });
}

export const artistDetails = (id: string) =>
  once(`artist:${id}`, () => getJson<{ details: ArtistDetails }>(`/api/musicbrainz/details?type=artist&id=${id}`).then(r => r.details));

export const songDetails = (id: string) =>
  once(`song:${id}`, () => getJson<{ details: RecordingDetails }>(`/api/musicbrainz/details?type=recording&id=${id}`).then(r => r.details));

export const artistNeighborhood = (id: string): Promise<ArtistNeighborhood> => once(`neighborhood:${id}`, async () => {
  const result = await getJson<{ neighborhood: ArtistNeighborhood }>(`/api/musicbrainz/neighborhood?id=${id}`);
  if (result.neighborhood.failed.length) memo.delete(`neighborhood:${id}`);
  return result.neighborhood;
});

/** Collaborators shared by two artists. A first scan of two big catalogues takes ~10 s. */
export const collaborators = (a: string, b: string) =>
  once(`collab:${a}:${b}`, () => getJson<{ collaborators: CollaboratorComparison }>(`/api/musicbrainz/collaborators?a=${a}&b=${b}`).then(r => r.collaborators));

/** The artist's most popular song (ranked by Deezer) as a MusicBrainz recording, or null. */
export const topTrack = (id: string, name: string) =>
  once(`top:${id}`, () => getJson<{ track: TopTrack | null }>(`/api/top-track?id=${id}&name=${encodeURIComponent(name)}`).then(r => r.track));

/**
 * Sound and lyric comparison of two songs (Spotify audio features + lyric analysis), matched by
 * title and lead artist. Resolves with a status; "unavailable" when the service isn't running.
 */
export const soundComparison = (a: RecordingDetails, b: RecordingDetails) =>
  once(`sound:${a.id}:${b.id}`, () => {
    const q = new URLSearchParams({ aTitle: a.title, aArtist: a.artists[0]?.name ?? '', bTitle: b.title, bArtist: b.artists[0]?.name ?? '' });
    return getJson<SoundResult>(`/api/sound?${q}`);
  });

/** Songs in the sound dataset (full analysis available); "unavailable" when the service is down. */
export const searchSoundSongs = (query: string, signal?: AbortSignal, limit = 10) =>
  getJson<SoundSearch>(`/api/sound/search?q=${encodeURIComponent(query)}&limit=${limit}`, signal);

