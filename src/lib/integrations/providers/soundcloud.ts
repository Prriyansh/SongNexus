// SoundCloud public API (https://developers.soundcloud.com/docs/api/guide, OpenAPI at
// /docs/api/explorer/api.json). OAuth 2.1: Authorization Code with PKCE, access tokens that last
// about an hour, and refresh tokens that work once (each refresh returns the next one), which is
// why refreshes are serialised per connection in ../connections.ts.
//
// Collections page with linked_partitioning: follow `next_href` until it's absent.
// Registering an app currently requires a SoundCloud Artist Pro account.

import { form, refreshWith, tokenCredentials } from "../http";
import type { Credentials, EntityInput, Json, Mutation, ProviderAdapter, StepContext } from "../types";
import { capabilitySet, entity, env, httpsUrl, isrc, list, num, optional, playlistResource, record, str, withQuery } from "./shared";

const AUTHORIZE = "https://secure.soundcloud.com/authorize";
const TOKEN = "https://secure.soundcloud.com/oauth/token";
const SIGN_OUT = "https://secure.soundcloud.com/sign-out";
const API = "https://api.soundcloud.com";
const PAGE = 200;

// SoundCloud's own scheme: "OAuth <token>", not "Bearer".
const authorization = (credentials: Credentials) => ({ Authorization: `OAuth ${credentials.accessToken}` });

export function soundcloudTrack(value: unknown): EntityInput | null {
  const track = record(value), uploader = record(track.user);
  // On SoundCloud the uploader is the artist unless the track says otherwise.
  const artist = optional(track.metadata_artist) ?? optional(uploader.username);
  return entity({
    kind: "track", providerId: str(track.urn) || str(track.id), title: str(track.title), artists: artist ? [artist] : [],
    durationMs: num(track.duration), isrc: isrc(track.isrc), url: httpsUrl(track.permalink_url), imageUrl: httpsUrl(track.artwork_url),
  });
}

type Collection = { collection?: unknown[]; next_href?: string | null };

/** The cursor is SoundCloud's own next_href, accepted only if it still points at their API. */
const collection = async (ctx: StepContext, path: string, cursor: Json | null, extra: Record<string, string | number> = {}) => {
  const url = typeof cursor === "string" && cursor.startsWith(`${API}/`) ? cursor : withQuery(`${API}${path}`, { linked_partitioning: "true", limit: PAGE, ...extra });
  const { data } = await ctx.get<Collection>(url);
  const items = list<Record<string, unknown>>(data?.collection);
  return { items, next: data?.next_href && items.length ? data.next_href : null };
};

const secrets = (source: Record<string, string | undefined>) => ({ client_id: env(source, "SOUNDCLOUD_CLIENT_ID"), client_secret: env(source, "SOUNDCLOUD_CLIENT_SECRET") });

export const soundcloud: ProviderAdapter = {
  id: "soundcloud",
  name: "SoundCloud",
  auth: "oauth",
  scopes: [],
  requiredEnv: ["SOUNDCLOUD_CLIENT_ID", "SOUNDCLOUD_CLIENT_SECRET"],
  setupNote: "Needs a SoundCloud app’s client ID and secret. SoundCloud currently lets Artist Pro accounts register apps.",
  importFormats: [],

  capabilities: (granted) => capabilitySet("SoundCloud", {
    profile: {},
    library: "On SoundCloud your library is your likes and playlists; they appear under Favorites and Playlists.",
    playlists: { note: "Playlists (sets) you created." },
    favorites: { note: "Liked tracks." },
    followed_artists: { note: "Accounts you follow." },
    top_items: "SoundCloud doesn’t share this.",
    recent_history: { note: "Your last 25 played tracks, in order, without times. SoundCloud’s API has no fuller history." },
    now_playing: "SoundCloud doesn’t share what’s playing.",
    sync_supported: { note: "Checked every 6 hours; recently played every hour." },
  }, granted),

  authorize: ({ env: e, redirectUri, state, codeChallenge }) => withQuery(AUTHORIZE, {
    client_id: env(e, "SOUNDCLOUD_CLIENT_ID"), response_type: "code", redirect_uri: redirectUri, state,
    code_challenge_method: "S256", code_challenge: codeChallenge,
  }),

  async handleCallback(ctx, { redirectUri, params, codeVerifier }) {
    const { data } = await ctx.request<Record<string, never>>(TOKEN, form({ grant_type: "authorization_code", code: params.get("code") ?? "", redirect_uri: redirectUri, code_verifier: codeVerifier, ...secrets(ctx.env) }));
    const { credentials } = tokenCredentials("SoundCloud", data);
    const me = await ctx.request<Record<string, unknown>>(`${API}/me`, { headers: authorization(credentials) });
    const id = str(me.data?.urn) || str(me.data?.id);
    return { credentials, scopes: [], profile: { id, name: str(me.data?.username) || id, url: httpsUrl(me.data?.permalink_url) } };
  },

  refreshCredentials: (ctx, credentials) => refreshWith("SoundCloud", async () => {
    const { data } = await ctx.request<Record<string, never>>(TOKEN, form({ grant_type: "refresh_token", refresh_token: credentials.refreshToken, ...secrets(ctx.env) }));
    return tokenCredentials("SoundCloud", data, credentials).credentials;
  }),

  authHeaders: authorization,

  // Invalidates the session's tokens on SoundCloud's side.
  async disconnect(ctx, credentials) {
    if (credentials.accessToken) await ctx.request(SIGN_OUT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: credentials.accessToken }) });
  },

  resources: [
    {
      key: "likes", capability: "favorites", label: "Liked tracks", mode: "snapshot", intervalMinutes: 360,
      owns: [{ relation: "favorite", kind: "track" }],
      async step(ctx, { cursor }) {
        const page = await collection(ctx, "/me/likes/tracks", cursor);
        return { next: page.next, mutations: page.items.flatMap((item): Mutation[] => { const e = soundcloudTrack(item); return e ? [{ type: "library", relation: "favorite", entity: e }] : []; }) };
      },
    },
    {
      key: "following", capability: "followed_artists", label: "Following", mode: "snapshot", intervalMinutes: 720,
      owns: [{ relation: "followed", kind: "artist" }],
      async step(ctx, { cursor }) {
        const page = await collection(ctx, "/me/followings", cursor);
        return {
          next: page.next,
          mutations: page.items.flatMap((u): Mutation[] => {
            const e = entity({ kind: "artist", providerId: str(u.urn) || str(u.id), title: str(u.username), url: httpsUrl(u.permalink_url), imageUrl: httpsUrl(u.avatar_url) });
            return e ? [{ type: "library", relation: "followed", entity: e }] : [];
          }),
        };
      },
    },
    playlistResource({
      intervalMinutes: 360,
      async list(ctx, cursor) {
        // show_tracks=false: the tracks are read per playlist, and only when the playlist changed.
        const page = await collection(ctx, "/me/playlists", cursor, { show_tracks: "false", limit: 50 });
        return {
          next: page.next,
          playlists: page.items.flatMap((p) => {
            const id = str(p.urn) || str(p.id);
            return id && str(p.title) ? [{
              providerId: id, name: str(p.title), description: optional(p.description), url: httpsUrl(p.permalink_url), imageUrl: httpsUrl(p.artwork_url),
              ownerName: optional(record(p.user).username), owned: true, trackCount: num(p.track_count),
              snapshot: str(p.last_modified) ? `${str(p.last_modified)}:${num(p.track_count) ?? ""}` : `poll:${ctx.now()}`,
            }] : [];
          }),
        };
      },
      async items(ctx, id, cursor) {
        const page = await collection(ctx, `/playlists/${encodeURIComponent(id)}/tracks`, cursor);
        return { next: page.next, items: page.items.flatMap((item) => { const e = soundcloudTrack(item); return e ? [{ entity: e, addedAt: undefined }] : []; }) };
      },
    }),
    {
      key: "recent", capability: "recent_history", label: "Recently played", mode: "snapshot", intervalMinutes: 60,
      owns: [{ relation: "recent", kind: "track" }],
      async step(ctx) {
        const { data } = await ctx.get<Collection | unknown[]>(`${API}/me/recently-played/tracks`);
        const rows = Array.isArray(data) ? data : list(data?.collection);
        const mutations = list(rows).flatMap((item, index): Mutation[] => { const e = soundcloudTrack(item); return e ? [{ type: "library", relation: "recent", entity: e, position: index + 1 }] : []; });
        return { mutations, next: null };
      },
    },
  ],
};
