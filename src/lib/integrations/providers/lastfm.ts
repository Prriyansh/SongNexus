// Last.fm account linking (https://www.last.fm/api/webauth) and scrobble history.
//
// Last.fm's web authentication isn't OAuth: the user approves the app on last.fm, comes back with a
// one-time token, and the server trades it (in a request signed with the shared secret) for a
// session key that doesn't expire. Requests about the user are then signed with that key, so
// profiles with private listening still work for their owner.
//
// Last.fm is the listening history for whatever the user scrobbles from: Spotify, YouTube Music
// through a browser extension, Apple Music through a scrobbler app. It only knows plays that were
// scrobbled, so it is never presented as someone's complete history.

import { createHash } from "node:crypto";
import { AccessDeniedError, ProviderError, RateLimitedError, ReauthRequiredError } from "../http";
import type { EntityInput, Mutation, ProviderAdapter, Requester, StepContext } from "../types";
import { capabilitySet, entity, env, httpsUrl, list, mbid, num, optional, record, str, textId, withQuery } from "./shared";

const API = "https://ws.audioscrobbler.com/2.0/";
const AUTHORIZE = "https://www.last.fm/api/auth/";
const PAGE = 200;

/** api_sig: every parameter except format, sorted by name, as name+value, then the secret, md5'd. */
export function lastfmSignature(params: Record<string, string>, secret: string): string {
  const text = Object.keys(params).filter((k) => k !== "format" && k !== "callback").sort().map((k) => k + params[k]).join("");
  return createHash("md5").update(text + secret, "utf8").digest("hex");
}

type LastfmError = { error?: number; message?: string };
// https://www.last.fm/api/errorcodes
const INVALID_SESSION = [4, 9, 14, 15], RATE_LIMITED = 29, LOGIN_REQUIRED = 17, TRANSIENT = [8, 11, 16];

/** A signed call. Last.fm reports failures as a code in the body, often with a 4xx status. */
async function call<T>(request: Requester, source: Record<string, string | undefined>, method: string, params: Record<string, string | number | undefined>, sessionKey?: string): Promise<T> {
  const all: Record<string, string> = { method, api_key: env(source, "LASTFM_API_KEY") };
  for (const [key, value] of Object.entries(params)) if (value !== undefined) all[key] = String(value);
  if (sessionKey) all.sk = sessionKey;
  all.api_sig = lastfmSignature(all, env(source, "LASTFM_SHARED_SECRET"));
  const { data } = await request<T & LastfmError>(withQuery(API, { ...all, format: "json" }), {}, { allowStatus: [400, 401, 403, 404] });
  const code = data?.error;
  if (!data) throw new ProviderError("Last.fm", "Last.fm returned a malformed response.");
  if (code === undefined) return data;
  if (INVALID_SESSION.includes(code)) throw new ReauthRequiredError("Last.fm", "Last.fm needs you to sign in again.");
  if (code === RATE_LIMITED) throw new RateLimitedError("Last.fm", 60_000);
  if (code === LOGIN_REQUIRED) throw new AccessDeniedError("Last.fm", "Last.fm says this profile’s listening is private.");
  throw new ProviderError("Last.fm", `Last.fm error ${code}.`, 502, TRANSIENT.includes(code));
}

const get = <T>(ctx: StepContext, method: string, params: Record<string, string | number | undefined>) =>
  call<T>(ctx.get, ctx.env, method, { user: ctx.credentials.extra?.username, ...params }, ctx.credentials.extra?.sessionKey);

const name = (value: unknown) => { const v = record(value); return str(v["#text"]) || str(v.name); };
const pages = (attr: unknown) => num(record(attr).totalPages) ?? 1;

export function lastfmTrack(value: unknown): EntityInput | null {
  const track = record(value);
  const artist = name(track.artist), title = str(track.name);
  if (!artist || !title) return null;
  const images = list(track.image);
  return entity({
    // Last.fm itself identifies a track by artist and title, so that pair is the stable id.
    kind: "track", providerId: textId(artist, title), title, artists: [artist], album: optional(name(track.album)),
    mbid: mbid(track.mbid), durationMs: num(track.duration) ? num(track.duration)! * 1000 : undefined,
    url: httpsUrl(track.url), imageUrl: httpsUrl(images[images.length - 1]?.["#text"]),
  });
}
const lastfmArtist = (value: unknown): EntityInput | null => {
  const artist = record(value);
  return entity({ kind: "artist", providerId: textId(str(artist.name)), title: str(artist.name), mbid: mbid(artist.mbid), url: httpsUrl(artist.url) });
};

const TOP_PERIODS = ["1month", "12month", "overall"] as const;

export const lastfm: ProviderAdapter = {
  id: "lastfm",
  name: "Last.fm",
  auth: "oauth",
  scopes: [],
  requiredEnv: ["LASTFM_API_KEY", "LASTFM_SHARED_SECRET"],
  setupNote: "Needs a Last.fm API account’s key and shared secret.",
  importFormats: [],

  capabilities: (granted) => capabilitySet("Last.fm", {
    profile: {},
    library: "Last.fm’s library is your scrobbles; they appear under listening history.",
    playlists: "Last.fm removed playlists from its API.",
    favorites: { note: "Loved tracks." },
    followed_artists: "Last.fm’s API doesn’t list followed artists.",
    top_items: { note: "Last.fm’s charts for the last month, the last year and all time." },
    recent_history: { note: "Every scrobble on your profile, with times. Only plays you scrobbled: listening that wasn’t sent to Last.fm isn’t here." },
    now_playing: { note: "What a scrobbler says is playing, as of the last check." },
    sync_supported: { note: "Checked every 10 minutes. The first sync reads your whole history, 200 scrobbles a request." },
  }, granted),

  // Last.fm returns the user to `cb` with ?token=…, so the state rides in the callback address itself.
  authorize: ({ env: e, redirectUri, state }) => withQuery(AUTHORIZE, { api_key: env(e, "LASTFM_API_KEY"), cb: withQuery(redirectUri, { state }) }),

  async handleCallback(ctx, { params }) {
    const token = params.get("token") ?? "";
    if (!token) throw new ProviderError("Last.fm", "Last.fm didn’t return an authorization.", 400);
    const reply = await call<{ session?: { name?: string; key?: string } }>(ctx.request, ctx.env, "auth.getSession", { token });
    const username = str(reply.session?.name), sessionKey = str(reply.session?.key);
    if (!username || !sessionKey) throw new ProviderError("Last.fm", "Last.fm didn’t return a session.");
    return { credentials: { extra: { username, sessionKey } }, scopes: [], profile: { id: username.toLowerCase(), name: username, url: `https://www.last.fm/user/${encodeURIComponent(username)}` } };
  },

  // Requests are authorized by signature, not by a header.
  authHeaders: (): Record<string, string> => ({}),

  resources: [
    {
      key: "recent", capability: "recent_history", label: "Scrobbles", mode: "append", intervalMinutes: 10,
      // Pages run newest to oldest and shift as new scrobbles arrive, so each pass fixes `to` first.
      async step(ctx, { cursor, checkpoint }) {
        const at = record(cursor);
        const page = num(at.page) ?? 1;
        const to = num(at.to) ?? Math.floor(ctx.now() / 1000);
        const from = typeof checkpoint === "number" ? checkpoint : undefined;
        const data = await get<{ recenttracks?: { track?: unknown; "@attr"?: unknown } }>(ctx, "user.getRecentTracks", { limit: PAGE, page, to, from });
        const mutations: Mutation[] = [];
        let playing: EntityInput | null = null;
        for (const track of list(data.recenttracks?.track)) {
          const e = lastfmTrack(track);
          if (!e) continue;
          const uts = num(record(track.date).uts);
          if (record(track["@attr"]).nowplaying === "true") playing = e;
          else if (uts) mutations.push({ type: "play", entity: e, playedAt: new Date(uts * 1000).toISOString() });
        }
        if (page === 1) mutations.push({ type: "now_playing", entity: playing });
        return page < pages(data.recenttracks?.["@attr"]) ? { mutations, next: { page: page + 1, to } } : { mutations, next: null, checkpoint: to };
      },
    },
    {
      key: "loved", capability: "favorites", label: "Loved tracks", mode: "snapshot", intervalMinutes: 360,
      owns: [{ relation: "favorite", kind: "track" }],
      async step(ctx, { cursor }) {
        const page = typeof cursor === "number" ? cursor : 1;
        const data = await get<{ lovedtracks?: { track?: unknown; "@attr"?: unknown } }>(ctx, "user.getLovedTracks", { limit: PAGE, page });
        const mutations = list(data.lovedtracks?.track).flatMap((track): Mutation[] => {
          const e = lastfmTrack(track), uts = num(record(track.date).uts);
          return e ? [{ type: "library", relation: "favorite", entity: e, addedAt: uts ? new Date(uts * 1000).toISOString() : undefined }] : [];
        });
        return { mutations, next: page < pages(data.lovedtracks?.["@attr"]) ? page + 1 : null };
      },
    },
    {
      key: "top", capability: "top_items", label: "Charts", mode: "snapshot", intervalMinutes: 1440,
      owns: TOP_PERIODS.flatMap((period) => [{ relation: "top" as const, period, kind: "track" as const }, { relation: "top" as const, period, kind: "artist" as const }]),
      async step(ctx, { cursor }) {
        const index = typeof cursor === "number" ? cursor : 0;
        const period = TOP_PERIODS[Math.floor(index / 2)];
        const tracks = index % 2 === 0;
        const data = await get<{ toptracks?: { track?: unknown }; topartists?: { artist?: unknown } }>(ctx, tracks ? "user.getTopTracks" : "user.getTopArtists", { period, limit: 50 });
        const rows = tracks ? list(data.toptracks?.track) : list(data.topartists?.artist);
        const mutations = rows.flatMap((row, position): Mutation[] => {
          const e = tracks ? lastfmTrack(row) : lastfmArtist(row);
          return e ? [{ type: "library", relation: "top", period, entity: e, position: position + 1 }] : [];
        });
        return { mutations, next: index + 1 < TOP_PERIODS.length * 2 ? index + 1 : null };
      },
    },
  ],
};

