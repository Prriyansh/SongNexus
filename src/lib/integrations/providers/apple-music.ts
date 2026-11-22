// Apple Music API with MusicKit (https://developer.apple.com/documentation/applemusicapi).
//
// Two tokens are involved. The developer token is a JWT this server signs (ES256) with the team's
// MusicKit private key; it identifies the app and never belongs to a user. The Music User Token
// comes from MusicKit JS in the browser after the user approves access in Apple's own window, and
// is posted to us once to be stored encrypted. Apple issues no refresh token: when the user token
// expires (about six months) or is revoked, the API answers 401/403 and the user reconnects.
//
// The library endpoints need an active Apple Music subscription; without one Apple answers 403.
// "Recently played" comes without timestamps, so those tracks are stored as an ordered list, not
// as plays. Apple shares no account name or id, so a connection is labelled by its storefront.

import { createHash, createPrivateKey, createSign } from "node:crypto";
import { ProviderError, ReauthRequiredError } from "../http";
import type { Credentials, EntityInput, Json, Mutation, ProviderAdapter, StepContext } from "../types";
import { capabilitySet, entity, env, httpsUrl, isoDate, list, num, optional, playlistResource, record, str, withQuery } from "./shared";

const API = "https://api.music.apple.com";
const TOKEN_LIFE_SECONDS = 12 * 60 * 60;
const PAGE = 100;

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const cache = new Map<string, { token: string; expires: number }>();

/**
 * The developer token. Signed fresh every 12 hours (Apple allows up to 6 months; a short life limits
 * what a leaked token is good for, since the browser needs a copy to run MusicKit).
 */
export function appleDeveloperToken(source: Record<string, string | undefined>, now = Date.now()): string {
  const teamId = env(source, "APPLE_MUSIC_TEAM_ID"), keyId = env(source, "APPLE_MUSIC_KEY_ID");
  // Environment variables often carry the .p8 file with literal "\n" in place of line breaks.
  const pem = env(source, "APPLE_MUSIC_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (!teamId || !keyId || !pem) throw new ProviderError("Apple Music", "Apple Music isn’t set up on this server.");
  const cacheKey = `${teamId}:${keyId}:${createHash('sha256').update(pem).digest('hex')}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires - 60_000 > now) return hit.token;
  const iat = Math.floor(now / 1000);
  const body = `${b64(JSON.stringify({ alg: "ES256", kid: keyId }))}.${b64(JSON.stringify({ iss: teamId, iat, exp: iat + TOKEN_LIFE_SECONDS }))}`;
  let signature: Buffer;
  try {
    // JWTs want the raw r||s signature, not the DER encoding Node produces by default.
    signature = createSign("SHA256").update(body).sign({ key: createPrivateKey(pem), dsaEncoding: "ieee-p1363" });
  } catch {
    throw new ProviderError("Apple Music", "The Apple Music private key on this server couldn’t be read.");
  }
  const token = `${body}.${b64(signature)}`;
  cache.set(cacheKey, { token, expires: (iat + TOKEN_LIFE_SECONDS) * 1000 });
  return token;
}

const headers = (credentials: Credentials, source: Record<string, string | undefined>) => ({
  Authorization: `Bearer ${appleDeveloperToken(source)}`,
  "Music-User-Token": credentials.accessToken ?? "",
});

const artwork = (value: unknown) => httpsUrl(str(record(value).url).replace("{w}", "300").replace("{h}", "300"));

function appleEntity(kind: EntityInput["kind"], value: unknown): EntityInput | null {
  const item = record(value), a = record(item.attributes);
  const artist = optional(a.artistName);
  return entity({
    kind, providerId: str(item.id), title: str(a.name), artists: kind !== "artist" && artist ? [artist] : [],
    album: kind === "track" ? optional(a.albumName) : undefined, durationMs: num(a.durationInMillis),
    url: httpsUrl(a.url), imageUrl: artwork(a.artwork),
  });
}

type Page = { data?: unknown[]; next?: string };

/** Apple pages with a ready-made `next` path; the cursor is that path. */
const page = async (ctx: StepContext, path: string, cursor: Json | null) => {
  const url = typeof cursor === "string" && cursor.startsWith("/v1/") ? `${API}${cursor}` : withQuery(`${API}${path}`, { limit: PAGE });
  const { data } = await ctx.get<Page>(url);
  const items = list<Record<string, unknown>>(data?.data);
  return { items, next: data?.next && items.length ? data.next : null };
};

const libraryResource = (key: string, label: string, path: string, kind: EntityInput["kind"]): ProviderAdapter["resources"][number] => ({
  key, capability: "library", label, mode: "snapshot", intervalMinutes: 360, owns: [{ relation: "saved", kind }],
  async step(ctx, { cursor }) {
    const result = await page(ctx, path, cursor);
    return { next: result.next, mutations: result.items.flatMap((item): Mutation[] => { const e = appleEntity(kind, item); return e ? [{ type: "library", relation: "saved", entity: e, addedAt: isoDate(record(item.attributes).dateAdded) }] : []; }) };
  },
});

export const appleMusic: ProviderAdapter = {
  id: "apple-music",
  name: "Apple Music",
  auth: "musickit",
  scopes: [],
  requiredEnv: ["APPLE_MUSIC_TEAM_ID", "APPLE_MUSIC_KEY_ID", "APPLE_MUSIC_PRIVATE_KEY"],
  setupNote: "Needs an Apple Developer Program membership and a MusicKit key. Users need an Apple Music subscription for their library to be readable.",
  importFormats: ["apple-music-activity", "apple-music-library"],

  capabilities: (granted) => capabilitySet("Apple Music", {
    profile: { note: "Apple shares no name or account id; the connection shows your storefront (country)." },
    library: { note: "Library songs, albums and artists. Needs an Apple Music subscription." },
    playlists: { note: "Library playlists and their tracks." },
    favorites: "Apple’s API doesn’t list favourited songs separately from the library.",
    followed_artists: "Library artists are included under Library; Apple’s API has no separate follow list.",
    top_items: { note: "Heavy rotation: the albums and playlists Apple says you play most right now." },
    recent_history: { note: "Recently played tracks, in order, without times. Apple’s API has no timestamps or full history; import “Apple Music Play Activity” from privacy.apple.com for that." },
    now_playing: "Apple’s web API doesn’t share what’s playing on your devices.",
    sync_supported: { note: "Checked every 6 hours; recently played every hour." },
    manual_import: { note: "Apple’s data export: play activity and library tracks." },
  }, granted),

  // The token comes from MusicKit JS; here it's proven to work before anything is stored.
  async connectWithToken(ctx, input) {
    const token = typeof input.musicUserToken === "string" ? input.musicUserToken.trim() : "";
    if (!token || token.length > 2000) throw new ProviderError("Apple Music", "Apple Music didn’t return an authorization.", 400);
    const credentials: Credentials = { accessToken: token };
    let reply;
    try {
      reply = await ctx.request<Page>(`${API}/v1/me/storefront`, { headers: headers(credentials, ctx.env) });
    } catch (error) {
      if (error instanceof ReauthRequiredError) throw new ProviderError("Apple Music", "Apple Music didn’t accept that authorization. Please try connecting again.", 400);
      throw error;
    }
    const storefront = record(list(reply.data?.data)[0]);
    const id = str(storefront.id) || "unknown";
    const name = optional(record(storefront.attributes).name);
    return { credentials, scopes: [], profile: { id: `storefront:${id}`, name: name ? `Apple Music (${name})` : "Apple Music" } };
  },

  authHeaders: headers,

  resources: [
    libraryResource("library.tracks", "Library songs", "/v1/me/library/songs", "track"),
    libraryResource("library.albums", "Library albums", "/v1/me/library/albums", "album"),
    libraryResource("library.artists", "Library artists", "/v1/me/library/artists", "artist"),
    playlistResource({
      intervalMinutes: 360,
      async list(ctx, cursor) {
        const result = await page(ctx, "/v1/me/library/playlists", cursor);
        return {
          next: result.next,
          playlists: result.items.flatMap((p) => {
            const a = record(p.attributes);
            return p.id && str(a.name) ? [{
              providerId: str(p.id), name: str(a.name), description: optional(record(a.description).standard), imageUrl: artwork(a.artwork),
              owned: a.canEdit !== false,
              // Apple gives no version id; the modified date changes when tracks do.
              snapshot: str(a.lastModifiedDate) || `poll:${ctx.now()}`,
            }] : [];
          }),
        };
      },
      async items(ctx, id, cursor) {
        const result = await page(ctx, `/v1/me/library/playlists/${encodeURIComponent(id)}/tracks`, cursor);
        return { next: result.next, items: result.items.flatMap((item) => { const e = appleEntity("track", item); return e ? [{ entity: e }] : []; }) };
      },
    }),
    {
      key: "recent", capability: "recent_history", label: "Recently played", mode: "snapshot", intervalMinutes: 60,
      owns: [{ relation: "recent", kind: "track" }],
      // Apple returns up to 10 per page and no more than about 50 in all.
      async step(ctx, { cursor }) {
        const offset = typeof cursor === "number" ? cursor : 0;
        const { data } = await ctx.get<Page>(withQuery(`${API}/v1/me/recent/played/tracks`, { limit: 10, offset, types: "songs,library-songs" }));
        const items = list(data?.data);
        const mutations = items.flatMap((item, index): Mutation[] => { const e = appleEntity("track", item); return e ? [{ type: "library", relation: "recent", entity: e, position: offset + index + 1 }] : []; });
        return { mutations, next: data?.next && items.length && offset + items.length < 50 ? offset + items.length : null };
      },
    },
    {
      key: "heavy-rotation", capability: "top_items", label: "Heavy rotation", mode: "snapshot", intervalMinutes: 1440,
      owns: [{ relation: "top", period: "heavy-rotation", kind: "album" }],
      async step(ctx) {
        const { data } = await ctx.get<Page>(withQuery(`${API}/v1/me/history/heavy-rotation`, { limit: 10 }));
        // Heavy rotation mixes albums, playlists and stations; albums are the ones that are music items here.
        const mutations = list(data?.data).filter((item) => /albums$/.test(str(item.type))).flatMap((item, index): Mutation[] => {
          const e = appleEntity("album", item);
          return e ? [{ type: "library", relation: "top", period: "heavy-rotation", entity: e, position: index + 1 }] : [];
        });
        return { mutations, next: null };
      },
    },
  ],
};
