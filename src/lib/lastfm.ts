// Listener counts and similar artists from Last.fm, by MusicBrainz id. Needs LASTFM_API_KEY (free).
// "Similar" here is listener behaviour: it never means two artists worked together.

import { UpstreamError, withCache } from "./musicbrainz";
import { sourceJson } from "./credit-sources";
import type { SourceOptions } from "./credit-sources";
import type { ArtistAudience, SimilarArtist } from "./types";

const BASE = "https://ws.audioscrobbler.com/2.0/";
const CACHE_MS = 60 * 60_000;
const SIMILAR_LIMIT = 100;
/** Last.fm's error for an id it doesn't know: an answer, not a failure. */
const NOT_FOUND = 6;

type Info = { artist?: { url?: string; stats?: { listeners?: string; playcount?: string; plays?: string } }; error?: number; message?: string };
type Similar = { similarartists?: { artist?: { name?: string; mbid?: string; url?: string }[] }; error?: number; message?: string };

export const lastFmKey = (env: Record<string, string | undefined> = process.env) => env.LASTFM_API_KEY?.trim() || null;

async function call<T extends { error?: number; message?: string }>(method: string, mbid: string, key: string, extra: string, options: SourceOptions): Promise<T | null> {
  const url = `${BASE}?method=${method}&mbid=${mbid}${extra}&api_key=${encodeURIComponent(key)}&format=json`;
  const data = await withCache(`lastfm:${method}:${mbid}`, CACHE_MS, options.useCache ?? true, async () => {
    try {
      return await sourceJson<T>("Last.fm", url, {}, options);
    } catch (error) {
      // Last.fm answers unknown ids with an HTTP error as well as a code in the body.
      if (error instanceof UpstreamError && error.message.includes("(404)")) return { error: NOT_FOUND } as T;
      throw error;
    }
  });
  if (data.error === NOT_FOUND) return null;
  if (data.error) throw new UpstreamError(`Last.fm error ${data.error}.`, 502, false);
  return data;
}

export async function lastFmAudience(mbid: string, key: string, options: SourceOptions = {}): Promise<ArtistAudience["lastFm"]> {
  const info = await call<Info>("artist.getinfo", mbid, key, "", options);
  const stats = info?.artist?.stats;
  const listeners = Number(stats?.listeners);
  if (!stats || !Number.isFinite(listeners) || !info?.artist?.url) return null;
  return { listeners, plays: Number(stats.playcount ?? stats.plays) || 0, url: info.artist.url };
}

export async function lastFmSimilar(mbid: string, key: string, options: SourceOptions = {}): Promise<SimilarArtist[]> {
  const data = await call<Similar>("artist.getsimilar", mbid, key, `&limit=${SIMILAR_LIMIT}`, options);
  return (data?.similarartists?.artist ?? []).flatMap((a) => a.name && a.url ? [{ name: a.name, mbid: a.mbid || null, url: a.url }] : []);
}
