// What someone listens to, from services that publish it by username: ListenBrainz (open, no key),
// Last.fm (needs LASTFM_API_KEY) and Deezer (a public profile's favourite artists, no key). Each
// artist is matched to the catalog by MusicBrainz ID, or else by its exact name. Server only.
import type { Catalog } from "./catalog";
import { normalize, searchCatalog } from "./search";
import type { Service } from "./services";
import type { ArtistRef } from "./types";
import { artistRef } from "./words";

export const TOP = 50;

export type Heard = { name: string; mbid: string | null; plays: number | null };
export type Listened = { name: string; plays: number | null; artist: ArtistRef | null };

/** Why listening couldn't be read: no such user, a service that isn't set up, or one that failed. */
export class ListeningError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 502 | 503,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

async function read(url: string, fetchImpl: Fetch): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
  } catch {
    throw new ListeningError("The service didn’t answer.", 502);
  }
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body };
}

const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value : []);
const field = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((at, key) => (at && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined), value);
const count = (value: unknown) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null);
const text = (value: unknown) => (typeof value === "string" ? value : "");

async function listenBrainz(user: string, fetchImpl: Fetch): Promise<Heard[]> {
  const { status, body } = await read(`https://api.listenbrainz.org/1/stats/user/${encodeURIComponent(user)}/artists?count=${TOP}&range=all_time`, fetchImpl);
  if (status === 404) throw new ListeningError("ListenBrainz has no user by that name.", 404);
  if (status === 204) return []; // statistics not worked out yet
  if (status !== 200) throw new ListeningError("ListenBrainz didn’t answer.", 502);
  return list(field(body, "payload", "artists")).map((a) => ({
    name: text(a.artist_name),
    mbid: text(a.artist_mbid) || text(list(a.artist_mbids)[0]) || null,
    plays: count(a.listen_count),
  }));
}

async function lastFm(user: string, key: string | null, fetchImpl: Fetch): Promise<Heard[]> {
  if (!key) throw new ListeningError("Last.fm isn’t set up on this server.", 503);
  const { status, body } = await read(
    `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(user)}&limit=${TOP}&api_key=${encodeURIComponent(key)}&format=json`,
    fetchImpl,
  );
  // Last.fm's code 6 is "no such user", sent with an error status or without one.
  if (field(body, "error") === 6) throw new ListeningError("Last.fm has no user by that name.", 404);
  if (status !== 200 || field(body, "error")) throw new ListeningError("Last.fm didn’t answer.", 502);
  return list(field(body, "topartists", "artist")).map((a) => ({
    name: text(a.name),
    mbid: text(a.mbid) || null,
    plays: count(a.playcount),
  }));
}

async function deezer(user: string, fetchImpl: Fetch): Promise<Heard[]> {
  const { status, body } = await read(`https://api.deezer.com/user/${user}/artists?limit=${TOP}`, fetchImpl);
  const error = field(body, "error");
  if (error) {
    // 800 is "no data": no such user, or a profile kept private.
    if (field(error, "code") === 800) throw new ListeningError("Deezer has no public profile with that number.", 404);
    throw new ListeningError("Deezer didn’t answer.", 502);
  }
  if (status !== 200) throw new ListeningError("Deezer didn’t answer.", 502);
  return list(field(body, "data")).map((a) => ({ name: text(a.name), mbid: null, plays: null }));
}

export function heardFrom(service: Service, user: string, env: Record<string, string | undefined>, fetchImpl: Fetch): Promise<Heard[]> {
  if (service === "listenbrainz") return listenBrainz(user, fetchImpl);
  if (service === "lastfm") return lastFm(user, env.LASTFM_API_KEY?.trim() || null, fetchImpl);
  return deezer(user, fetchImpl);
}

/** Each artist heard, with the catalog's artist when there is one by that ID or exact name. */
export function matchHeard(c: Catalog, heard: Heard[]): Listened[] {
  return heard
    .filter((h) => h.name)
    .slice(0, TOP)
    .map((h) => {
      let at = h.mbid ? c.artistAt.get(h.mbid.toLowerCase()) : undefined;
      if (at === undefined) {
        const [found] = searchCatalog(c, h.name, ["artist"], 1);
        if (found && normalize(found.name) === normalize(h.name)) at = c.artistAt.get(found.id);
      }
      return { name: h.name, plays: h.plays, artist: at === undefined ? null : artistRef(c, at) };
    });
}
