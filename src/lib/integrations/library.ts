// Reads a user's synced and imported music back out. Every query filters by the user's id, shows
// an import only once it's committed, and labels each row with where it came from.
//
// Sources are shown one at a time. The one combined view is "combined": the user's open sources
// together (see ./policy.ts), available only after they've agreed to it. Display-only sources such
// as Spotify and YouTube can never be part of it.

import { ApiProblem } from "../accounts/http";
import { consents } from "../accounts/users";
import type { Sql } from "../db";
import { iso } from "../db";
import { IMPORT_FORMATS } from "./import-formats";
import { OPEN_SOURCES, sourceDataUse } from "./policy";
import { adapter } from "./registry";
import { isProviderId } from "./types";
import type { EntityKind, LibraryEntity, LibraryItem, NowPlayingView, PlaylistTrack, PlaylistView, PlayView, Relation, SourceCoverage, SourceRef } from "./types";

export const COMBINED = "combined";
const RELATIONS: Relation[] = ["saved", "favorite", "followed", "top", "recent"];
const KINDS: EntityKind[] = ["track", "album", "artist"];
const MAX_PAGE = 100;

type EntityRow = { entity_id: string; kind: EntityKind; title: string; artists: string[]; album: string | null; duration_ms: number | null; url: string | null; image_url: string | null; isrc: string | null; mbid: string | null };
type SourceRow = { provider: string | null; format: string | null; filename: string | null };

const ENTITY = "pe.id AS entity_id, pe.kind, pe.title, pe.artists, pe.album, pe.duration_ms, pe.url, pe.image_url, pe.isrc, pe.mbid";
const SOURCE = "c.provider, i.format, i.filename";
const SOURCE_KEY = "COALESCE(c.provider, 'import:' || i.format)";
const joins = (alias: string) => `LEFT JOIN connections c ON c.id = ${alias}.connection_id LEFT JOIN imports i ON i.id = ${alias}.import_id`;
const visible = (alias: string) => `(${alias}.import_id IS NULL OR i.status = 'committed')`;

const entity = (row: EntityRow): LibraryEntity => ({ id: row.entity_id, kind: row.kind, title: row.title, artists: row.artists ?? [], album: row.album, durationMs: row.duration_ms, url: row.url, imageUrl: row.image_url, isrc: row.isrc, mbid: row.mbid });

export function sourceRef(row: SourceRow): SourceRef {
  if (row.provider) return { provider: row.provider, label: isProviderId(row.provider) ? adapter(row.provider).name : row.provider, via: "sync", use: sourceDataUse(row.provider) };
  const key = `import:${row.format}`;
  return { provider: key, label: `${IMPORT_FORMATS[row.format ?? ""]?.label ?? "Import"}${row.filename ? ` · ${row.filename}` : ""}`, via: "import", use: sourceDataUse(key) };
}

const page = (limit: unknown, offset: unknown) => ({
  limit: Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(limit) || 50))),
  offset: Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset) || 0)) : 0,
});

/** The SQL condition and parameter for a source filter. "combined" needs the user's consent. */
async function sourceFilter(sql: Sql, userId: string, source: string | null, index: number): Promise<{ where: string; params: unknown[]; combined: boolean }> {
  if (!source) throw new ApiProblem("Choose a source to show.", 400);
  if (source === COMBINED) {
    if (!(await consents(sql, userId)).includes("combine_sources")) throw new ApiProblem("Turn on “Combine my open sources” first.", 403, { consentRequired: "combine_sources" });
    return { where: `${SOURCE_KEY} IN (SELECT value FROM jsonb_array_elements_text($${index}::jsonb))`, params: [JSON.stringify(OPEN_SOURCES)], combined: true };
  }
  if (source.length > 80) throw new ApiProblem("Unknown source.", 400);
  return { where: `${SOURCE_KEY} = $${index}`, params: [source], combined: false };
}

export type LibraryQuery = { source: string | null; relation?: string | null; kind?: string | null; q?: string | null; limit?: unknown; offset?: unknown };

export async function listLibrary(sql: Sql, userId: string, query: LibraryQuery): Promise<{ items: LibraryItem[]; total: number }> {
  const filter = await sourceFilter(sql, userId, query.source, 2);
  const params: unknown[] = [userId, ...filter.params];
  const where = [`li.user_id = $1`, visible("li"), filter.where];
  if (query.relation) {
    if (!RELATIONS.includes(query.relation as Relation)) throw new ApiProblem("Unknown list.", 400);
    params.push(query.relation); where.push(`li.relation = $${params.length}`);
  }
  if (query.kind) {
    if (!KINDS.includes(query.kind as EntityKind)) throw new ApiProblem("Unknown kind.", 400);
    params.push(query.kind); where.push(`pe.kind = $${params.length}`);
  }
  const q = query.q?.trim().slice(0, 100);
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(pe.title ILIKE $${params.length} OR pe.artists::text ILIKE $${params.length} OR pe.album ILIKE $${params.length})`);
  }
  const { limit, offset } = page(query.limit, query.offset);
  // Other open sources of this user holding the same recording, by exact identifier. Only in the combined view.
  const alsoIn = filter.combined
    ? `(SELECT COALESCE(jsonb_agg(DISTINCT x.src), '[]'::jsonb) FROM (
         SELECT COALESCE(c2.provider, 'import:' || i2.format) AS src FROM library_items l2
         JOIN provider_entities p2 ON p2.id = l2.entity_id LEFT JOIN connections c2 ON c2.id = l2.connection_id LEFT JOIN imports i2 ON i2.id = l2.import_id
         WHERE l2.user_id = li.user_id AND pe.canonical_id IS NOT NULL AND p2.canonical_id = pe.canonical_id AND p2.id <> pe.id AND (l2.import_id IS NULL OR i2.status = 'committed')) x)`
    : "'[]'::jsonb";
  const from = `FROM library_items li JOIN provider_entities pe ON pe.id = li.entity_id ${joins("li")} WHERE ${where.join(" AND ")}`;
  const [{ total }] = await sql.query<{ total: number }>(`SELECT count(*)::int AS total ${from}`, params);
  const rows = await sql.query<EntityRow & SourceRow & { relation: Relation; period: string; position: number | null; added_at: unknown; also_in: string[] }>(
    `SELECT ${ENTITY}, ${SOURCE}, li.relation, li.period, li.position, li.added_at, ${alsoIn} AS also_in ${from}
     ORDER BY li.relation, li.period, li.position NULLS LAST, li.added_at DESC NULLS LAST, pe.title, pe.id
     LIMIT ${limit} OFFSET ${offset}`, params);
  return {
    total,
    items: rows.map((row) => ({ entity: entity(row), relation: row.relation, period: row.period, addedAt: iso(row.added_at), position: row.position, source: sourceRef(row), alsoIn: row.also_in ?? [] })),
  };
}

type PlaylistRow = SourceRow & { id: string; name: string; description: string | null; url: string | null; image_url: string | null; owner_name: string | null; owned: boolean; track_count: number | null; snapshot: string | null; synced_snapshot: string | null };
const playlistView = (row: PlaylistRow): PlaylistView => ({
  id: row.id, name: row.name, description: row.description, url: row.url, imageUrl: row.image_url, ownerName: row.owner_name, owned: row.owned, trackCount: row.track_count,
  itemsSynced: row.snapshot !== null && row.snapshot === row.synced_snapshot, source: sourceRef(row),
});
const PLAYLIST = "p.id, p.name, p.description, p.url, p.image_url, p.owner_name, p.owned, p.track_count, p.snapshot, p.synced_snapshot";

export async function listPlaylists(sql: Sql, userId: string, source: string | null): Promise<PlaylistView[]> {
  const filter = await sourceFilter(sql, userId, source, 2);
  const rows = await sql.query<PlaylistRow>(
    `SELECT ${PLAYLIST}, ${SOURCE} FROM playlists p ${joins("p")} WHERE p.user_id = $1 AND ${visible("p")} AND ${filter.where} ORDER BY lower(p.name), p.id`, [userId, ...filter.params]);
  return rows.map(playlistView);
}

export async function playlistTracks(sql: Sql, userId: string, playlistId: string, query: { limit?: unknown; offset?: unknown }): Promise<{ playlist: PlaylistView; tracks: PlaylistTrack[]; total: number }> {
  const valid = /^[0-9a-f-]{36}$/i.test(playlistId);
  const [row] = valid ? await sql.query<PlaylistRow>(`SELECT ${PLAYLIST}, ${SOURCE} FROM playlists p ${joins("p")} WHERE p.id = $1 AND p.user_id = $2 AND ${visible("p")}`, [playlistId, userId]) : [];
  if (!row) throw new ApiProblem("That playlist wasn’t found.", 404);
  const { limit, offset } = page(query.limit, query.offset);
  const [{ total }] = await sql.query<{ total: number }>("SELECT count(*)::int AS total FROM playlist_items WHERE playlist_id = $1", [playlistId]);
  const tracks = await sql.query<EntityRow & { position: number; added_at: unknown }>(
    `SELECT ${ENTITY}, pi.position, pi.added_at FROM playlist_items pi JOIN provider_entities pe ON pe.id = pi.entity_id WHERE pi.playlist_id = $1 ORDER BY pi.position LIMIT ${limit} OFFSET ${offset}`, [playlistId]);
  return { playlist: playlistView(row), total, tracks: tracks.map((t) => ({ position: t.position, addedAt: iso(t.added_at), entity: entity(t) })) };
}

/** Plays, newest first. `before` accepts the returned opaque cursor or a legacy ISO time. */
export async function listPlays(sql: Sql, userId: string, query: { source: string | null; before?: string | null; limit?: unknown }): Promise<{ plays: PlayView[]; next: string | null }> {
  const filter = await sourceFilter(sql, userId, query.source, 2);
  const params: unknown[] = [userId, ...filter.params];
  let before = "";
  if (query.before) {
    const [time, id] = query.before.split('|');
    if (Number.isNaN(Date.parse(time)) || id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ApiProblem("Invalid history cursor.", 400);
    params.push(new Date(time).toISOString());
    if (id) {
      params.push(id);
      before = `AND (le.played_at, le.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    } else before = `AND le.played_at < $${params.length}::timestamptz`;
  }
  const { limit } = page(query.limit, 0);
  const rows = await sql.query<EntityRow & SourceRow & { play_id: string; played_at: unknown; ms_played: number | null }>(
    `SELECT ${ENTITY}, ${SOURCE}, le.id AS play_id, le.played_at, le.ms_played FROM listening_events le JOIN provider_entities pe ON pe.id = le.entity_id ${joins("le")}
     WHERE le.user_id = $1 AND ${visible("le")} AND ${filter.where} ${before} ORDER BY le.played_at DESC, le.id DESC LIMIT ${limit + 1}`, params);
  const plays = rows.slice(0, limit).map((row) => ({ playedAt: iso(row.played_at)!, msPlayed: row.ms_played, entity: entity(row), source: sourceRef(row) }));
  return { plays, next: rows.length > limit ? `${plays[plays.length - 1].playedAt}|${rows[limit - 1].play_id}` : null };
}

export async function nowPlaying(sql: Sql, userId: string): Promise<NowPlayingView[]> {
  const rows = await sql.query<EntityRow & { provider: string; checked_at: unknown }>(
    `SELECT ${ENTITY}, c.provider, np.checked_at FROM now_playing np JOIN connections c ON c.id = np.connection_id JOIN provider_entities pe ON pe.id = np.entity_id
     WHERE np.user_id = $1 AND np.checked_at > now() - interval '30 minutes' ORDER BY np.checked_at DESC`, [userId]);
  return rows.map((row) => ({ entity: entity(row), checkedAt: iso(row.checked_at)!, source: sourceRef({ provider: row.provider, format: null, filename: null }) }));
}

/** Per source: how much is stored and how far back the plays go. This is what "coverage" means in the UI. */
export async function coverage(sql: Sql, userId: string): Promise<SourceCoverage[]> {
  const sources = await sql.query<SourceRow & { key: string; last_success_at: unknown }>(
    `SELECT c.provider, NULL AS format, NULL AS filename, c.provider AS key, c.last_success_at FROM connections c WHERE c.user_id = $1
     UNION ALL
     SELECT NULL, i.format, i.filename, 'import:' || i.id::text, i.committed_at FROM imports i WHERE i.user_id = $1 AND i.status = 'committed'`, [userId]);
  const library = await sql.query<{ key: string; kind: EntityKind; n: number }>(
    `SELECT COALESCE(c.provider, 'import:' || i.id::text) AS key, pe.kind, count(DISTINCT pe.id)::int AS n
     FROM library_items li JOIN provider_entities pe ON pe.id = li.entity_id ${joins("li")}
     WHERE li.user_id = $1 AND ${visible("li")} AND li.relation IN ('saved', 'favorite', 'followed') GROUP BY 1, 2`, [userId]);
  const playlists = await sql.query<{ key: string; n: number }>(
    `SELECT COALESCE(c.provider, 'import:' || i.id::text) AS key, count(*)::int AS n FROM playlists p ${joins("p")} WHERE p.user_id = $1 AND ${visible("p")} GROUP BY 1`, [userId]);
  const plays = await sql.query<{ key: string; n: number; oldest: unknown; newest: unknown }>(
    `SELECT COALESCE(c.provider, 'import:' || i.id::text) AS key, count(*)::int AS n, min(le.played_at) AS oldest, max(le.played_at) AS newest
     FROM listening_events le ${joins("le")} WHERE le.user_id = $1 AND ${visible("le")} GROUP BY 1`, [userId]);
  return sources.map((row) => {
    const count = (kind: EntityKind) => library.find((l) => l.key === row.key && l.kind === kind)?.n ?? 0;
    const played = plays.find((p) => p.key === row.key);
    return {
      source: sourceRef(row), tracks: count("track"), albums: count("album"), artists: count("artist"),
      playlists: playlists.find((p) => p.key === row.key)?.n ?? 0, plays: played?.n ?? 0,
      oldestPlay: iso(played?.oldest), newestPlay: iso(played?.newest), lastSuccessAt: iso(row.last_success_at),
    };
  });
}

/**
 * Songs to hand to the Connection Web as a playlist: from open sources only, the user's loved
 * tracks first, then what they've played most. Requires the combine-sources consent.
 */
export async function discoveryPlaylist(sql: Sql, userId: string, limit = 100): Promise<{ title: string; artist: string }[]> {
  const filter = await sourceFilter(sql, userId, COMBINED, 2);
  const rows = await sql.query<{ title: string; artist: string }>(
    `SELECT t.title, t.artist FROM (
       SELECT pe.title, pe.artists->>0 AS artist, 1 AS rank, count(*) AS weight
       FROM library_items li JOIN provider_entities pe ON pe.id = li.entity_id ${joins("li")}
       WHERE li.user_id = $1 AND ${visible("li")} AND ${filter.where} AND pe.kind = 'track' AND li.relation IN ('favorite', 'saved') GROUP BY 1, 2
       UNION ALL
       SELECT pe.title, pe.artists->>0, 2, count(*)
       FROM listening_events le JOIN provider_entities pe ON pe.id = le.entity_id ${joins("le")}
       WHERE le.user_id = $1 AND ${visible("le")} AND ${filter.where} GROUP BY 1, 2) t
     WHERE t.artist IS NOT NULL AND t.artist <> ''
     GROUP BY t.title, t.artist ORDER BY min(t.rank), sum(t.weight) DESC, t.title LIMIT ${Math.min(250, Math.max(1, limit))}`, [userId, ...filter.params]);
  return rows;
}
