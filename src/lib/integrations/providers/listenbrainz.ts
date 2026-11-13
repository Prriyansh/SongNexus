// ListenBrainz (https://listenbrainz.readthedocs.io/en/latest/users/api/). Open listening data
// from MetaBrainz, the people behind MusicBrainz.
//
// Linking uses the user's own API token, which is ListenBrainz's documented way for another app to
// act for a user: they copy it from listenbrainz.org/settings and paste it here. It's checked with
// /1/validate-token, stored encrypted like any other credential, and needs no developer account,
// so this is the one integration that works on every server with no setup.
//
// Like Last.fm, it holds only the plays that were submitted to it.

import { ProviderError } from "../http";
import type { EntityInput, Json, Mutation, ProviderAdapter, StepContext, StepResult } from "../types";
import { capabilitySet, entity, isoDate, isrc, list, mbid, num, optional, playlistResource, record, str, textId, withQuery } from "./shared";

export const LISTENBRAINZ_API = "https://api.listenbrainz.org";
const LISTENS_PAGE = 1000; // The API's maximum.
const FEEDBACK_PAGE = 100;
const PLAYLIST_PAGE = 25;

const user = (ctx: StepContext) => encodeURIComponent(ctx.credentials.extra?.username ?? ctx.profile.name);

/** A listen's track. The recording MBID comes from the submitter, or from ListenBrainz's own mapping. */
export function listenTrack(value: unknown): EntityInput | null {
  const listen = record(value), meta = record(listen.track_metadata);
  const info = record(meta.additional_info), mapping = record(meta.mbid_mapping);
  const title = str(meta.track_name), artist = str(meta.artist_name);
  const recording = mbid(mapping.recording_mbid) ?? mbid(info.recording_mbid) ?? mbid(listen.recording_mbid);
  const msid = str(listen.recording_msid) || str(info.recording_msid);
  return entity({
    kind: "track", providerId: msid || recording || textId(artist, title), title, artists: artist ? [artist] : [],
    album: optional(meta.release_name), mbid: recording, isrc: isrc(info.isrc),
    durationMs: num(info.duration_ms) ?? (num(info.duration) ? num(info.duration)! * 1000 : undefined),
    url: recording ? `https://musicbrainz.org/recording/${recording}` : undefined,
  });
}

type Listens = { payload?: { listens?: unknown[] } };

const playlistId = (identifier: unknown) => str(Array.isArray(identifier) ? identifier[0] : identifier).split("/").filter(Boolean).pop() ?? "";

export const listenbrainz: ProviderAdapter = {
  id: "listenbrainz",
  name: "ListenBrainz",
  auth: "token",
  scopes: [],
  requiredEnv: [],
  setupNote: "Works on every server: you link it with your own ListenBrainz token.",
  importFormats: ["listenbrainz-listens"],
  tokenHelp: { label: "ListenBrainz user token", url: "https://listenbrainz.org/settings/" },

  capabilities: (granted) => capabilitySet("ListenBrainz", {
    profile: {},
    library: "ListenBrainz keeps listens, not a saved library.",
    playlists: { note: "Your ListenBrainz playlists, including generated ones." },
    favorites: { note: "Recordings you’ve loved." },
    followed_artists: "ListenBrainz follows are people, not artists.",
    top_items: "ListenBrainz publishes statistics, but Song Nexus doesn’t read them yet.",
    recent_history: { note: "Recent submitted listens with timestamps, then incremental updates. Import a ListenBrainz export for older history; unsubmitted listening is unavailable." },
    now_playing: { note: "What a submitter says is playing, as of the last check." },
    sync_supported: { note: "Checked every 10 minutes, up to 1,000 recent listens per check. Older history requires an export." },
    manual_import: { note: "A ListenBrainz export (listens as JSON lines)." },
  }, granted),

  async connectWithToken(ctx, input) {
    const token = typeof input.token === "string" ? input.token.trim() : "";
    if (!/^[A-Za-z0-9-]{20,64}$/.test(token)) throw new ProviderError("ListenBrainz", "That doesn’t look like a ListenBrainz token. Copy it from listenbrainz.org/settings.", 400);
    const { data } = await ctx.request<{ valid?: boolean; user_name?: string }>(`${LISTENBRAINZ_API}/1/validate-token`, { headers: { Authorization: `Token ${token}` } });
    const username = str(data?.user_name);
    if (!data?.valid || !username) throw new ProviderError("ListenBrainz", "ListenBrainz didn’t accept that token. Copy it again from listenbrainz.org/settings.", 400);
    return { credentials: { accessToken: token, extra: { username } }, scopes: [], profile: { id: username.toLowerCase(), name: username, url: `https://listenbrainz.org/user/${encodeURIComponent(username)}/` } };
  },

  authHeaders: (credentials) => ({ Authorization: `Token ${credentials.accessToken}` }),

  resources: [
    {
      key: "recent", capability: "recent_history", label: "Listens", mode: "append", intervalMinutes: 10,
      // The official API requires exports for full historical imports. Use this endpoint only
      // for a recent window and incremental updates. Overlap one second to retain boundary plays.
      async step(ctx, { checkpoint }): Promise<StepResult> {
        const since = typeof checkpoint === "number" ? checkpoint - 1 : undefined;
        const { data } = await ctx.get<Listens>(withQuery(`${LISTENBRAINZ_API}/1/user/${user(ctx)}/listens`, { count: LISTENS_PAGE, min_ts: since }));
        const mutations: Mutation[] = [];
        const times: number[] = [];
        for (const listen of list(data?.payload?.listens)) {
          const e = listenTrack(listen), ts = num(listen.listened_at);
          if (!ts) continue;
          times.push(ts);
          if (e) mutations.push({ type: "play", entity: e, playedAt: new Date(ts * 1000).toISOString() });
        }
        mutations.push(...await playingNow(ctx));
        const newest = Math.max(typeof checkpoint === "number" ? checkpoint : 0, ...times);
        return { mutations, next: null, checkpoint: newest || null };
      },
    },
    {
      key: "loved", capability: "favorites", label: "Loved recordings", mode: "snapshot", intervalMinutes: 360,
      owns: [{ relation: "favorite", kind: "track" }],
      async step(ctx, { cursor }) {
        const offset = typeof cursor === "number" ? cursor : 0;
        const { data } = await ctx.get<{ feedback?: unknown[]; total_count?: number }>(withQuery(`${LISTENBRAINZ_API}/1/feedback/user/${user(ctx)}/get-feedback`, { score: 1, count: FEEDBACK_PAGE, offset, metadata: "true" }));
        const rows = list(data?.feedback);
        const mutations = rows.flatMap((row): Mutation[] => {
          const e = listenTrack(row), created = num(row.created);
          return e ? [{ type: "library", relation: "favorite", entity: e, addedAt: created ? new Date(created * 1000).toISOString() : undefined }] : [];
        });
        return { mutations, next: rows.length && offset + rows.length < (data?.total_count ?? 0) ? offset + rows.length : null };
      },
    },
    playlistResource({
      intervalMinutes: 360,
      async list(ctx, cursor) {
        const offset = typeof cursor === "number" ? cursor : 0;
        const { data } = await ctx.get<{ playlists?: unknown[]; playlist_count?: number }>(withQuery(`${LISTENBRAINZ_API}/1/user/${user(ctx)}/playlists`, { count: PLAYLIST_PAGE, offset }));
        const rows = list(data?.playlists);
        return {
          next: rows.length && offset + rows.length < (data?.playlist_count ?? 0) ? offset + rows.length : null,
          playlists: rows.flatMap((row) => {
            const p = record(row.playlist), id = playlistId(p.identifier);
            const extension = record(record(p.extension)["https://musicbrainz.org/doc/jspf#playlist"]);
            return id && str(p.title) ? [{
              providerId: id, name: str(p.title), description: optional(p.annotation), url: `https://listenbrainz.org/playlist/${id}`,
              ownerName: optional(p.creator), owned: str(p.creator).toLowerCase() === ctx.profile.id,
              snapshot: str(extension.last_modified_at) || `poll:${ctx.now()}`,
            }] : [];
          }),
        };
      },
      // A playlist comes back whole, as JSPF.
      async items(ctx, id) {
        const { data } = await ctx.get<{ playlist?: { track?: unknown[] } }>(`${LISTENBRAINZ_API}/1/playlist/${encodeURIComponent(id)}`);
        return {
          next: null as Json | null,
          items: list(data?.playlist?.track).flatMap((track) => {
            const recording = mbid(playlistId(track.identifier));
            const added = record(record(track.extension)["https://musicbrainz.org/doc/jspf#track"]).added_at;
            const e = entity({
              kind: "track", providerId: recording ?? textId(str(track.creator), str(track.title)), title: str(track.title), artists: str(track.creator) ? [str(track.creator)] : [],
              album: optional(track.album), mbid: recording, durationMs: num(track.duration), url: recording ? `https://musicbrainz.org/recording/${recording}` : undefined,
            });
            return e ? [{ entity: e, addedAt: isoDate(added) }] : [];
          }),
        };
      },
    }),
  ],
};

async function playingNow(ctx: StepContext): Promise<Mutation[]> {
  try {
    const { data } = await ctx.get<Listens>(`${LISTENBRAINZ_API}/1/user/${user(ctx)}/playing-now`);
    return [{ type: "now_playing", entity: listenTrack(list(data?.payload?.listens)[0]) }];
  } catch {
    return [];
  }
}
