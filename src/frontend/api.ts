// Browser-side client for our own Next.js API routes. The page never calls MusicBrainz or
// Deezer directly; the routes handle rate limits, retries and server caching.
import type { Artist, ArtistDetails, ArtistInsights, CollaboratorComparison, MoreCredits, RecordingDetails, SimilarWeb, Song, TasteMap, TasteRequest, TopTrack } from '@/lib/types';
import type { SoundResult, SoundSearch } from '@/lib/sound';
import type { Room, RoomMember } from '@/lib/rooms';

export class ApiError extends Error {
  retryable: boolean;
  /** This server doesn't offer the feature at all. */
  unavailable = false;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'ApiError';
    this.retryable = retryable;
  }
}

/** MusicBrainz sometimes answers "busy"; retryable errors get one more try before the user sees them. */
export const retryPolicy = { delayMs: 1500 };

async function getJson<T>(url: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  try {
    return await getJsonOnce<T>(url, signal, init);
  } catch (error) {
    if (!(error instanceof ApiError) || !error.retryable || signal?.aborted) throw error;
    await new Promise(resolve => setTimeout(resolve, retryPolicy.delayMs));
    if (signal?.aborted) throw error;
    return getJsonOnce<T>(url, signal, init);
  }
}

async function getJsonOnce<T>(url: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init ? { ...init, signal } : { signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach Song Nexus. Check your connection and try again.', true);
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string; retryable?: boolean; unavailable?: boolean };
  if (!response.ok) {
    const failure = new ApiError(body.error || `Request failed (${response.status}).`, !body.unavailable && (Boolean(body.retryable) || response.status >= 500));
    failure.unavailable = Boolean(body.unavailable);
    throw failure;
  }
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

/**
 * Collaborators shared by two artists. A first scan of two big catalogues can take most of a minute.
 * A scan that ran out of time isn't remembered, so asking again continues it.
 */
export const collaborators = (a: string, b: string) =>
  once(`collab:${a}:${b}`, async () => {
    const { collaborators: result } = await getJson<{ collaborators: CollaboratorComparison }>(`/api/musicbrainz/collaborators?a=${a}&b=${b}`);
    if (result.coverage.a.partial || result.coverage.b.partial) memo.delete(`collab:${a}:${b}`);
    return result;
  });

/** What Genius and Discogs add to the collaborators. Sources that are missing or fail are reported, not thrown. */
export const moreCredits = (a: string, b: string) =>
  once(`credits:${a}:${b}`, () => getJson<{ credits: MoreCredits }>(`/api/credits?a=${a}&b=${b}`).then(r => r.credits));

/** Artists and songs similar to this one, each with the reasons it's there. */
export const similarMusic = (kind: 'artist' | 'song', id: string) =>
  once(`similar:${kind}:${id}`, () => getJson<{ similar: SimilarWeb }>(`/api/similar?kind=${kind}&id=${id}`).then(r => r.similar));

/** A map from one playlist, or two. The playlists go in the request body, and aren't stored anywhere. */
export const tasteWeb = (request: TasteRequest) =>
  once(`taste:${JSON.stringify(request)}`, () => getJson<{ taste: TasteMap }>('/api/taste', undefined, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }).then(r => r.taste));

type RoomReply = { room: Room };
const jsonPost = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Opens a room and returns its short code. */
export const createRoom = (member: RoomMember) => getJson<{ code: string }>('/api/rooms', undefined, jsonPost(member)).then(r => r.code);
/** Never memoized: the room changes when a friend joins. */
export const readRoom = (code: string) => getJson<RoomReply>(`/api/rooms/${encodeURIComponent(code)}`).then(r => r.room);
export const joinRoom = (code: string, member: RoomMember) => getJson<RoomReply>(`/api/rooms/${encodeURIComponent(code)}`, undefined, jsonPost(member)).then(r => r.room);

/** Bio, awards, labels, audience and shared facts for two artists. */
export const artistInsights = (a: string, b: string) =>
  once(`insights:${a}:${b}`, () => getJson<{ insights: ArtistInsights }>(`/api/artist-insights?a=${a}&b=${b}`).then(r => r.insights));

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

