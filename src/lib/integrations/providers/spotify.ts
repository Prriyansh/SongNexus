// Spotify Web API, as published after the February 2026 changes
// (https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide and
// the OpenAPI schema). Authorization Code with PKCE; no client secret is used or needed.
//
// What that means here:
//   - Playlist contents come from GET /playlists/{id}/items and only for playlists the user owns or
//     collaborates on; other playlists are listed without their tracks.
//   - GET /me no longer returns email, country or product, and none is requested.
//   - Popularity and follower counts are gone and nothing here reads them.
//   - A Development Mode app works for at most 5 users the owner has added in the dashboard, and
//     the owner needs Premium. Anyone else gets 403 on every call, which surfaces on their card.
//
// Spotify data is display-only (see ../policy.ts): no ISRC matching, no graphs, no statistics.

import { form, refreshWith, tokenCredentials } from "../http";
import type { Credentials, EntityInput, Json, Mutation, ProviderAdapter, StepContext } from "../types";
import { capabilitySet, entity, env, httpsUrl, isoDate, list, num, optional, playlistResource, record, str, withQuery } from "./shared";

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const PAGE = 50;

const SCOPES = ["user-library-read", "playlist-read-private", "playlist-read-collaborative", "user-follow-read", "user-top-read", "user-read-recently-played", "user-read-currently-playing"];

const image = (value: unknown) => httpsUrl(list(value)[0]?.url);
const link = (value: unknown) => httpsUrl(record(record(value).external_urls).spotify);

export function spotifyTrack(value: unknown): EntityInput | null {
  const track = record(value);
  // Podcast episodes and local files aren't music the catalogue knows.
  if (track.type && track.type !== "track") return null;
  if (track.is_local || !track.id) return null;
  const album = record(track.album);
  return entity({
    kind: "track", providerId: str(track.id), title: str(track.name),
    artists: list(track.artists).map((a) => str(a.name)), album: optional(album.name),
    durationMs: num(track.duration_ms), url: link(track), imageUrl: image(album.images),
  });
}
const spotifyAlbum = (value: unknown): EntityInput | null => {
  const album = record(value);
  return entity({ kind: "album", providerId: str(album.id), title: str(album.name), artists: list(album.artists).map((a) => str(a.name)), url: link(album), imageUrl: image(album.images) });
};
const spotifyArtist = (value: unknown): EntityInput | null => {
  const artist = record(value);
  return entity({ kind: "artist", providerId: str(artist.id), title: str(artist.name), url: link(artist), imageUrl: image(artist.images) });
};

type Paging = { items?: unknown[]; next?: string | null; total?: number };

/** Offset paging: the cursor is the next offset. */
const offsetPage = async (ctx: StepContext, path: string, cursor: Json | null, extra: Record<string, string> = {}) => {
  const offset = typeof cursor === "number" ? cursor : 0;
  const { data } = await ctx.get<Paging>(withQuery(`${API}${path}`, { limit: PAGE, offset, ...extra }));
  const items = list<Record<string, unknown>>(data?.items);
  return { items, next: data?.next && items.length ? offset + items.length : null, offset };
};

const bearer = (credentials: Credentials) => ({ Authorization: `Bearer ${credentials.accessToken}` });
const TOP_RANGES = ["short_term", "medium_term", "long_term"] as const;

export const spotify: ProviderAdapter = {
  id: "spotify",
  name: "Spotify",
  auth: "oauth",
  scopes: SCOPES,
  requiredEnv: ["SPOTIFY_CLIENT_ID"],
  setupNote: "Needs a Spotify app’s client ID. In Development Mode the app’s owner needs Premium and must add each user (up to 5) in the Spotify dashboard.",
  importFormats: ["spotify-history", "spotify-library", "spotify-playlists"],

  capabilities: (granted) => capabilitySet("Spotify", {
    profile: { note: "Display name only. Spotify no longer shares email, country or plan." },
    library: { scopes: ["user-library-read"], note: "Saved songs and albums." },
    playlists: { scopes: ["playlist-read-private"], note: "Tracks are available only for playlists you own or collaborate on." },
    favorites: "Liked Songs are your saved songs on Spotify; they appear under Library.",
    followed_artists: { scopes: ["user-follow-read"] },
    top_items: { scopes: ["user-top-read"], note: "Spotify’s own ranking over about 4 weeks, 6 months and a year." },
    recent_history: { scopes: ["user-read-recently-played"], note: "Spotify only shares your last 50 plays. Plays are collected from the day you connect; earlier history needs your data export." },
    now_playing: { scopes: ["user-read-currently-playing"], note: "Checked while you have Song Nexus open." },
    sync_supported: { note: "Checked every 15 minutes for plays and every 6 hours for library and playlists." },
    manual_import: { note: "Your Spotify data export (listening history, library, playlists)." },
  }, granted),

  authorize: ({ env: e, redirectUri, state, codeChallenge }) => withQuery(AUTHORIZE, {
    client_id: env(e, "SPOTIFY_CLIENT_ID"), response_type: "code", redirect_uri: redirectUri, state,
    code_challenge_method: "S256", code_challenge: codeChallenge, scope: SCOPES.join(" "),
  }),

  async handleCallback(ctx, { redirectUri, params, codeVerifier }) {
    const { data } = await ctx.request<Record<string, never>>(TOKEN, form({
      grant_type: "authorization_code", code: params.get("code") ?? "", redirect_uri: redirectUri,
      client_id: env(ctx.env, "SPOTIFY_CLIENT_ID"), code_verifier: codeVerifier,
    }));
    const { credentials, scopes } = tokenCredentials("Spotify", data);
    const me = await ctx.request<{ id?: string; display_name?: string | null }>(`${API}/me`, { headers: bearer(credentials) });
    const id = str(me.data?.id);
    return { credentials, scopes: scopes ?? SCOPES, profile: { id, name: me.data?.display_name || id, url: link(me.data) } };
  },

  refreshCredentials: (ctx, credentials) => refreshWith("Spotify", async () => {
    const { data } = await ctx.request<Record<string, never>>(TOKEN, form({ grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: env(ctx.env, "SPOTIFY_CLIENT_ID") }));
    return tokenCredentials("Spotify", data, credentials).credentials;
  }),

  authHeaders: bearer,

  resources: [
    {
      key: "library.tracks", capability: "library", label: "Saved songs", mode: "snapshot", intervalMinutes: 360,
      scopes: ["user-library-read"], owns: [{ relation: "saved", kind: "track" }],
      async step(ctx, { cursor }) {
        const page = await offsetPage(ctx, "/me/tracks", cursor);
        return { next: page.next, mutations: page.items.flatMap((item): Mutation[] => { const e = spotifyTrack(item.track); return e ? [{ type: "library", relation: "saved", entity: e, addedAt: isoDate(item.added_at) }] : []; }) };
      },
    },
    {
      key: "library.albums", capability: "library", label: "Saved albums", mode: "snapshot", intervalMinutes: 360,
      scopes: ["user-library-read"], owns: [{ relation: "saved", kind: "album" }],
      async step(ctx, { cursor }) {
        const page = await offsetPage(ctx, "/me/albums", cursor);
        return { next: page.next, mutations: page.items.flatMap((item): Mutation[] => { const e = spotifyAlbum(item.album); return e ? [{ type: "library", relation: "saved", entity: e, addedAt: isoDate(item.added_at) }] : []; }) };
      },
    },
    {
      key: "following", capability: "followed_artists", label: "Followed artists", mode: "snapshot", intervalMinutes: 720,
      scopes: ["user-follow-read"], owns: [{ relation: "followed", kind: "artist" }],
      async step(ctx, { cursor }) {
        const { data } = await ctx.get<{ artists?: { items?: unknown[]; cursors?: { after?: string | null } } }>(withQuery(`${API}/me/following`, { type: "artist", limit: PAGE, after: typeof cursor === "string" ? cursor : undefined }));
        const items = list(data?.artists?.items);
        return { next: items.length ? data?.artists?.cursors?.after ?? null : null, mutations: items.flatMap((item): Mutation[] => { const e = spotifyArtist(item); return e ? [{ type: "library", relation: "followed", entity: e }] : []; }) };
      },
    },
    playlistResource({
      intervalMinutes: 360,
      scopes: ["playlist-read-private"],
      async list(ctx, cursor) {
        const page = await offsetPage(ctx, "/me/playlists", cursor);
        return {
          next: page.next,
          playlists: page.items.flatMap((p) => {
            const owner = record(p.owner);
            const owned = str(owner.id) === ctx.profile.id;
            const readable = owned || p.collaborative === true;
            // After February 2026 the count lives under `items`; older responses used `tracks`.
            const count = num(record(p.items).total) ?? num(record(p.tracks).total);
            return p.id && str(p.name) ? [{
              providerId: str(p.id), name: str(p.name), description: optional(p.description), url: link(p), imageUrl: image(p.images),
              ownerName: optional(owner.display_name) ?? optional(owner.id), owned, trackCount: count,
              snapshot: readable ? optional(p.snapshot_id) ?? `poll:${ctx.now()}` : undefined,
            }] : [];
          }),
        };
      },
      async items(ctx, id, cursor) {
        const page = await offsetPage(ctx, `/playlists/${encodeURIComponent(id)}/items`, cursor, { additional_types: "track" });
        return { next: page.next, items: page.items.flatMap((row) => { const e = spotifyTrack(row.item ?? row.track); return e ? [{ entity: e, addedAt: isoDate(row.added_at) }] : []; }) };
      },
    }),
    {
      key: "top", capability: "top_items", label: "Top songs and artists", mode: "snapshot", intervalMinutes: 1440,
      scopes: ["user-top-read"],
      owns: TOP_RANGES.flatMap((period) => [{ relation: "top" as const, period, kind: "track" as const }, { relation: "top" as const, period, kind: "artist" as const }]),
      // Six requests: tracks and artists for each of Spotify's three ranges, one per step.
      async step(ctx, { cursor }) {
        const index = typeof cursor === "number" ? cursor : 0;
        const period = TOP_RANGES[Math.floor(index / 2)];
        const type = index % 2 === 0 ? "tracks" : "artists";
        const { data } = await ctx.get<Paging>(withQuery(`${API}/me/top/${type}`, { time_range: period, limit: PAGE }));
        const mutations = list(data?.items).flatMap((item, position): Mutation[] => {
          const e = type === "tracks" ? spotifyTrack(item) : spotifyArtist(item);
          return e ? [{ type: "library", relation: "top", period, entity: e, position: position + 1 }] : [];
        });
        return { mutations, next: index + 1 < TOP_RANGES.length * 2 ? index + 1 : null };
      },
    },
    {
      key: "recent", capability: "recent_history", label: "Recent plays", mode: "append", intervalMinutes: 15,
      scopes: ["user-read-recently-played"],
      // One request returns at most the last 50 plays; `after` (ms) limits it to what's new.
      async step(ctx, { checkpoint }) {
        const after = typeof checkpoint === "number" ? checkpoint : undefined;
        const { data } = await ctx.get<{ items?: unknown[] }>(withQuery(`${API}/me/player/recently-played`, { limit: PAGE, after }));
        let newest = after ?? 0;
        const mutations = list(data?.items).flatMap((item): Mutation[] => {
          const e = spotifyTrack(item.track), playedAt = isoDate(item.played_at);
          if (!e || !playedAt) return [];
          newest = Math.max(newest, Date.parse(playedAt));
          return [{ type: "play", entity: e, playedAt }];
        });
        return { mutations, next: null, checkpoint: newest || null };
      },
    },
    {
      key: "now", capability: "now_playing", label: "Current track", mode: "append", intervalMinutes: 15,
      scopes: ["user-read-currently-playing"],
      async step(ctx) { return { mutations: await nowPlaying(ctx), next: null }; },
    },
  ],
};

/** 204 means nothing is playing. Authorization errors are handled independently from recent plays. */
async function nowPlaying(ctx: StepContext): Promise<Mutation[]> {
  const { data } = await ctx.get<{ is_playing?: boolean; currently_playing_type?: string; item?: unknown }>(`${API}/me/player/currently-playing`);
  const e = data?.is_playing && data.currently_playing_type === "track" ? spotifyTrack(data.item) : null;
  return [{ type: "now_playing", entity: e }];
}
