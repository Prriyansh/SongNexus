// YouTube Data API v3 through Google OAuth (https://developers.google.com/youtube/v3/docs).
//
// This is YouTube account access, not YouTube Music access. Google publishes no YouTube Music API,
// so with the read-only YouTube scope an app can read:
//   - the playlists on the user's channel (playlists made in YouTube Music are YouTube playlists,
//     so they appear here) and their items;
//   - the videos the user liked. Songs liked in YouTube Music are liked videos too; we keep the
//     ones YouTube files under its Music category.
// It cannot read: listening history (removed from the API in 2016), the YouTube Music library
// (saved albums, subscriptions to artists as "library"), uploads to YouTube Music, or what's playing.
// Those are covered, where possible, by a Google Takeout import instead.
//
// Every list call costs 1 unit of the project's 10,000-unit daily quota; a sync of 20 playlists is
// a few dozen units. An exhausted quota answers 403, which ../http.ts treats as a rate limit.

import { form, refreshWith, tokenCredentials } from "../http";
import type { Credentials, EntityInput, Json, Mutation, ProviderAdapter } from "../types";
import { capabilitySet, entity, env, httpsUrl, isoDate, isoDurationMs, list, num, optional, playlistResource, record, str, withQuery } from "./shared";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/youtube/v3";
const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const MUSIC_CATEGORY = "10";
const PAGE = 50;

const bearer = (credentials: Credentials) => ({ Authorization: `Bearer ${credentials.accessToken}` });
const thumbnail = (value: unknown) => { const t = record(value); return httpsUrl(record(t.medium ?? t.default).url); };
/** YouTube Music's auto-generated artist channels are named "Artist - Topic". */
export const channelArtist = (name: unknown) => str(name).replace(/\s+-\s+Topic$/, "").trim();

const video = (id: string, title: unknown, channel: unknown, thumbnails: unknown, duration?: unknown): EntityInput | null => {
  const name = str(title);
  // Placeholders the API returns for videos that were removed or made private.
  if (!id || name === "Deleted video" || name === "Private video") return null;
  const artist = channelArtist(channel);
  return entity({ kind: "track", providerId: id, title: name, artists: artist ? [artist] : [], durationMs: isoDurationMs(duration), url: `https://music.youtube.com/watch?v=${encodeURIComponent(id)}`, imageUrl: thumbnail(thumbnails) });
};

type Page = { items?: unknown[]; nextPageToken?: string };

export const youtube: ProviderAdapter = {
  id: "youtube",
  name: "YouTube / YouTube Music",
  auth: "oauth",
  scopes: [SCOPE],
  requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  setupNote: "Needs a Google Cloud OAuth client with the YouTube Data API enabled. Until Google verifies the app, only test users added to its consent screen can connect.",
  importFormats: ["youtube-music-history", "youtube-music-library"],

  capabilities: (granted) => capabilitySet("YouTube", {
    profile: { note: "Your YouTube channel name." },
    library: "Google has no API for the YouTube Music library (saved albums and songs). Import it from Google Takeout instead.",
    playlists: { scopes: [SCOPE], note: "Playlists on your YouTube channel, including ones made in YouTube Music." },
    favorites: { scopes: [SCOPE], note: "Liked videos in YouTube’s Music category. Songs liked in YouTube Music are included; so are other liked music videos." },
    followed_artists: "Subscriptions are YouTube channels, not YouTube Music artists, so they aren’t read.",
    top_items: "YouTube doesn’t share this.",
    recent_history: "YouTube removed watch history from its API in 2016. Import your YouTube Music history from Google Takeout, or connect Last.fm or ListenBrainz if you scrobble.",
    now_playing: "YouTube doesn’t share what’s playing.",
    sync_supported: { note: "Checked every 6 hours, well inside Google’s daily quota." },
    manual_import: { note: "Google Takeout: YouTube Music watch history and library." },
  }, granted),

  authorize: ({ env: e, redirectUri, state, codeChallenge }) => withQuery(AUTHORIZE, {
    client_id: env(e, "GOOGLE_CLIENT_ID"), response_type: "code", redirect_uri: redirectUri, state, scope: SCOPE,
    code_challenge_method: "S256", code_challenge: codeChallenge,
    // offline + consent: Google only returns a refresh token on a consented, offline request.
    access_type: "offline", prompt: "consent",
  }),

  async handleCallback(ctx, { redirectUri, params, codeVerifier }) {
    const { data } = await ctx.request<Record<string, never>>(TOKEN, form({
      grant_type: "authorization_code", code: params.get("code") ?? "", redirect_uri: redirectUri, code_verifier: codeVerifier,
      client_id: env(ctx.env, "GOOGLE_CLIENT_ID"), client_secret: env(ctx.env, "GOOGLE_CLIENT_SECRET"),
    }));
    const { credentials, scopes } = tokenCredentials("YouTube", data);
    const mine = await ctx.request<Page>(withQuery(`${API}/channels`, { part: "snippet", mine: "true" }), { headers: bearer(credentials) });
    const channel = record(list(mine.data?.items)[0]);
    const snippet = record(channel.snippet);
    // A Google account without a YouTube channel can still have liked videos.
    const id = str(channel.id) || "no-channel";
    return { credentials, scopes: scopes ?? [SCOPE], profile: { id, name: str(snippet.title) || "YouTube account", url: channel.id ? `https://www.youtube.com/channel/${id}` : undefined } };
  },

  refreshCredentials: (ctx, credentials) => refreshWith("YouTube", async () => {
    const { data } = await ctx.request<Record<string, never>>(TOKEN, form({
      grant_type: "refresh_token", refresh_token: credentials.refreshToken,
      client_id: env(ctx.env, "GOOGLE_CLIENT_ID"), client_secret: env(ctx.env, "GOOGLE_CLIENT_SECRET"),
    }));
    return tokenCredentials("YouTube", data, credentials).credentials;
  }),

  authHeaders: bearer,

  // Google revokes the grant itself, so nothing lingers in the user's Google account.
  async disconnect(ctx, credentials) {
    const token = credentials.refreshToken ?? credentials.accessToken;
    if (token) await ctx.request(REVOKE, form({ token }));
  },

  resources: [
    playlistResource({
      intervalMinutes: 360,
      async list(ctx, cursor) {
        // 404 channelNotFound: the account has no channel, so it has no playlists.
        const { data } = await ctx.get<Page>(withQuery(`${API}/playlists`, { part: "snippet,contentDetails", mine: "true", maxResults: PAGE, pageToken: typeof cursor === "string" ? cursor : undefined }), {}, { allowStatus: [404] });
        return {
          next: data?.nextPageToken ?? null,
          playlists: list(data?.items).flatMap((p) => {
            const snippet = record(p.snippet), count = num(record(p.contentDetails).itemCount);
            const id = str(p.id);
            return id && str(snippet.title) ? [{
              providerId: id, name: str(snippet.title), description: optional(snippet.description), url: `https://music.youtube.com/playlist?list=${encodeURIComponent(id)}`,
              imageUrl: thumbnail(snippet.thumbnails), ownerName: optional(snippet.channelTitle), owned: true, trackCount: count,
              // A playlist resource etag is not a reliable version for its item ordering.
              // Re-read contents each polling pass, including same-count replacements/reorders.
              snapshot: `poll:${ctx.now()}`,
            }] : [];
          }),
        };
      },
      async items(ctx, id, cursor) {
        const { data } = await ctx.get<Page>(withQuery(`${API}/playlistItems`, { part: "snippet,contentDetails", playlistId: id, maxResults: PAGE, pageToken: typeof cursor === "string" ? cursor : undefined }));
        return {
          next: data?.nextPageToken ?? null,
          items: list(data?.items).flatMap((item) => {
            const snippet = record(item.snippet);
            const e = video(str(record(item.contentDetails).videoId) || str(record(snippet.resourceId).videoId), snippet.title, snippet.videoOwnerChannelTitle, snippet.thumbnails);
            return e ? [{ entity: e, addedAt: isoDate(snippet.publishedAt) }] : [];
          }),
        };
      },
    }),
    {
      key: "likes", capability: "favorites", label: "Liked music", mode: "snapshot", intervalMinutes: 360,
      owns: [{ relation: "favorite", kind: "track" }],
      async step(ctx, { cursor }) {
        const { data } = await ctx.get<Page>(withQuery(`${API}/videos`, { part: "snippet,contentDetails", myRating: "like", maxResults: PAGE, pageToken: typeof cursor === "string" ? cursor : undefined }));
        const mutations = list(data?.items).flatMap((item): Mutation[] => {
          const snippet = record(item.snippet);
          if (str(snippet.categoryId) !== MUSIC_CATEGORY) return [];
          const e = video(str(item.id), snippet.title, snippet.channelTitle, snippet.thumbnails, record(item.contentDetails).duration);
          return e ? [{ type: "library", relation: "favorite", entity: e }] : [];
        });
        return { mutations, next: (data?.nextPageToken ?? null) as Json | null };
      },
    },
  ],
};
