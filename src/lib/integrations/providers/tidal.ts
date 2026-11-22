// TIDAL API v2 (https://developer.tidal.com, OpenAPI at
// https://tidal-music.github.io/tidal-api-reference/tidal-api-oas.json). Authorization Code with
// PKCE; the documents are JSON:API, so a list is resource identifiers in `data` plus the resources
// themselves in `included`, paged by `links.meta.nextCursor`.
//
// Third-party apps can read the collection (tracks, albums, artists) and the user's playlists.
// The spec has no listening-history endpoint, and playback state is limited to TIDAL's own
// clients, so recent plays and now-playing aren't offered.

import { form, refreshWith, tokenCredentials } from "../http";
import type { Credentials, EntityInput, EntityKind, Json, Mutation, ProviderAdapter, StepContext } from "../types";
import { capabilitySet, entity, env, httpsUrl, isoDate, isoDurationMs, isrc, list, num, optional, playlistResource, record, str, withQuery } from "./shared";

const AUTHORIZE = "https://login.tidal.com/authorize";
const TOKEN = "https://auth.tidal.com/v1/oauth2/token";
const API = "https://openapi.tidal.com/v2";
const SCOPES = ["user.read", "collection.read", "playlists.read"];
const LOOKUP_BATCH = 20;

const headers = (credentials: Credentials) => ({ Authorization: `Bearer ${credentials.accessToken}`, Accept: "application/vnd.api+json" });

type Resource = { id?: string; type?: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: unknown }>; meta?: Record<string, unknown> };
type Document = { data?: Resource[] | Resource; included?: Resource[]; links?: { next?: string; meta?: { nextCursor?: string } } };

const index = (doc: Document | null) => new Map(list<Resource>(doc?.included).map((r) => [`${r.type}:${r.id}`, r]));
const related = (resource: Resource, relation: string, included: Map<string, Resource>) =>
  list<Resource>(resource.relationships?.[relation]?.data).flatMap((ref) => included.get(`${ref.type}:${ref.id}`) ?? []);
const sharing = (attributes: Record<string, unknown>) => httpsUrl(list(attributes.externalLinks).find((l) => record(l.meta).type === "TIDAL_SHARING")?.href);

const nextCursor = (doc: Document | null): string | null => {
  const direct = doc?.links?.meta?.nextCursor;
  if (direct) return direct;
  const next = doc?.links?.next;
  return next ? new URL(next, API).searchParams.get("page[cursor]") : null;
};

/** A resource from `included`. Artist and album names are other included resources, joined by relationship. */
export function tidalEntity(resource: Resource | undefined, included: Map<string, Resource>): EntityInput | null {
  if (!resource?.id || !resource.attributes) return null;
  const a = resource.attributes;
  const kind: EntityKind | null = resource.type === "tracks" ? "track" : resource.type === "albums" ? "album" : resource.type === "artists" ? "artist" : null;
  if (!kind) return null;
  if (kind === "artist") return entity({ kind, providerId: resource.id, title: str(a.name), url: sharing(a) ?? `https://tidal.com/browse/artist/${resource.id}` });
  const version = optional(a.version);
  return entity({
    kind, providerId: resource.id, title: version ? `${str(a.title)} (${version})` : str(a.title),
    artists: related(resource, "artists", included).map((artist) => str(artist.attributes?.name)),
    album: kind === "track" ? optional(related(resource, "albums", included)[0]?.attributes?.title) : undefined,
    durationMs: isoDurationMs(a.duration), isrc: kind === "track" ? isrc(a.isrc) : undefined,
    url: sharing(a) ?? `https://tidal.com/browse/${kind}/${resource.id}`,
  });
}

const country = (ctx: StepContext) => ctx.credentials.extra?.country || undefined;

/**
 * One page of a relationship, with its tracks resolved. `include=items.artists` asks for the names
 * in the same response; if a page comes back without them, the tracks are looked up in batches.
 */
async function itemsPage(ctx: StepContext, path: string, cursor: Json | null, kind: EntityKind) {
  const nested = kind === "track" ? "items,items.artists,items.albums" : kind === "album" ? "items,items.artists" : "items";
  const { data: doc } = await ctx.get<Document>(withQuery(`${API}${path}`, { include: nested, countryCode: country(ctx), "page[cursor]": typeof cursor === "string" ? cursor : undefined }));
  const included = index(doc);
  const refs = list<Resource>(doc?.data);
  const unnamed = kind === "track" ? refs.filter((ref) => { const r = included.get(`${ref.type}:${ref.id}`); return !r || !related(r, "artists", included).length; }).map((ref) => str(ref.id)).filter(Boolean) : [];
  for (let i = 0; i < unnamed.length; i += LOOKUP_BATCH) {
    const lookup = await ctx.get<Document>(withQuery(`${API}/tracks`, { "filter[id]": unnamed.slice(i, i + LOOKUP_BATCH).join(","), include: "artists,albums", countryCode: country(ctx) }));
    for (const r of [...list<Resource>(lookup.data?.data), ...list<Resource>(lookup.data?.included)]) included.set(`${r.type}:${r.id}`, r);
  }
  const rows = refs.flatMap((ref) => {
    const e = tidalEntity(included.get(`${ref.type}:${ref.id}`), included);
    return e && e.kind === kind ? [{ entity: e, addedAt: isoDate(ref.meta?.addedAt) }] : [];
  });
  return { rows, next: refs.length ? nextCursor(doc) : null };
}

const collectionResource = (key: string, label: string, path: string, kind: EntityKind, relation: "saved" | "followed"): ProviderAdapter["resources"][number] => ({
  key, capability: relation === "followed" ? "followed_artists" : "library", label, mode: "snapshot", intervalMinutes: 360,
  scopes: ["collection.read"], owns: [{ relation, kind }],
  async step(ctx, { cursor }) {
    const page = await itemsPage(ctx, path, cursor, kind);
    return { next: page.next, mutations: page.rows.map((row): Mutation => ({ type: "library", relation, entity: row.entity, addedAt: row.addedAt })) };
  },
});

export const tidal: ProviderAdapter = {
  id: "tidal",
  name: "TIDAL",
  auth: "oauth",
  scopes: SCOPES,
  requiredEnv: ["TIDAL_CLIENT_ID"],
  setupNote: "Needs a TIDAL developer app’s client ID with the user.read, collection.read and playlists.read scopes enabled.",
  importFormats: [],

  capabilities: (granted) => capabilitySet("TIDAL", {
    profile: { scopes: ["user.read"], note: "Username and country. Your email isn’t stored." },
    library: { scopes: ["collection.read"], note: "Tracks and albums in My Collection." },
    playlists: { scopes: ["playlists.read"], note: "Playlists you created." },
    favorites: "On TIDAL, favourites are My Collection; they appear under Library.",
    followed_artists: { scopes: ["collection.read"], note: "Artists in My Collection." },
    top_items: "TIDAL’s API doesn’t share this.",
    recent_history: "TIDAL’s API has no listening history for third-party apps.",
    now_playing: "Playback state is limited to TIDAL’s own apps.",
    sync_supported: { note: "Checked every 6 hours." },
  }, granted),

  authorize: ({ env: e, redirectUri, state, codeChallenge }) => withQuery(AUTHORIZE, {
    response_type: "code", client_id: env(e, "TIDAL_CLIENT_ID"), redirect_uri: redirectUri, scope: SCOPES.join(" "),
    code_challenge_method: "S256", code_challenge: codeChallenge, state,
  }),

  async handleCallback(ctx, { redirectUri, params, codeVerifier }) {
    const { data } = await ctx.request<Record<string, never>>(TOKEN, form({
      grant_type: "authorization_code", client_id: env(ctx.env, "TIDAL_CLIENT_ID"), client_secret: env(ctx.env, "TIDAL_CLIENT_SECRET") || undefined,
      code: params.get("code") ?? "", redirect_uri: redirectUri, code_verifier: codeVerifier,
    }));
    const { credentials, scopes } = tokenCredentials("TIDAL", data);
    const me = await ctx.request<Document>(`${API}/users/me`, { headers: headers(credentials) });
    const user = record(me.data?.data) as Resource;
    const id = str(user.id), a = record(user.attributes);
    // Only what's needed is kept: the id, a display name and the country used for catalogue lookups.
    return { credentials: { ...credentials, extra: { country: str(a.country) } }, scopes: scopes ?? SCOPES, profile: { id, name: str(a.username) || `TIDAL user ${id}` } };
  },

  refreshCredentials: (ctx, credentials) => refreshWith("TIDAL", async () => {
    const { data } = await ctx.request<Record<string, never>>(TOKEN, form({ grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: env(ctx.env, "TIDAL_CLIENT_ID"), client_secret: env(ctx.env, "TIDAL_CLIENT_SECRET") || undefined }));
    return { ...tokenCredentials("TIDAL", data, credentials).credentials, extra: credentials.extra };
  }),

  authHeaders: headers,

  resources: [
    collectionResource("library.tracks", "Collection tracks", "/userCollectionTracks/me/relationships/items", "track", "saved"),
    collectionResource("library.albums", "Collection albums", "/userCollectionAlbums/me/relationships/items", "album", "saved"),
    collectionResource("library.artists", "Collection artists", "/userCollectionArtists/me/relationships/items", "artist", "followed"),
    playlistResource({
      intervalMinutes: 360,
      scopes: ["playlists.read"],
      async list(ctx, cursor) {
        const { data: doc } = await ctx.get<Document>(withQuery(`${API}/playlists`, { "filter[owners.id]": "me", countryCode: country(ctx), "page[cursor]": typeof cursor === "string" ? cursor : undefined }));
        const rows = list<Resource>(doc?.data);
        return {
          next: rows.length ? nextCursor(doc) : null,
          playlists: rows.flatMap((p) => {
            const a = record(p.attributes);
            return p.id && str(a.name) ? [{
              providerId: p.id, name: str(a.name), description: optional(a.description), url: sharing(a) ?? `https://tidal.com/browse/playlist/${p.id}`,
              owned: true, trackCount: num(a.numberOfItems), snapshot: str(a.lastModifiedAt) || `poll:${ctx.now()}`,
            }] : [];
          }),
        };
      },
      async items(ctx, id, cursor) {
        const page = await itemsPage(ctx, `/playlists/${encodeURIComponent(id)}/relationships/items`, cursor, "track");
        return { next: page.next, items: page.rows };
      },
    }),
  ],
};
