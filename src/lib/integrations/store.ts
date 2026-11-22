// Writes what a sync step or an import learned into the database. Everything is an upsert keyed
// on the source's own ids, so running the same page twice (a retry, a resumed job, a re-upload)
// leaves the same rows behind. Bulk writes send one JSON parameter per statement.

import type { Sql } from "../db";
import { isOpen } from "./policy";
import type { EntityInput, EntityKind, Mutation, Relation } from "./types";

/** Who a row belongs to: a connection (synced) or an import (uploaded). `source` names the policy class. */
export type Owner = { userId: string; source: string } & ({ connectionId: string; importId?: undefined } | { importId: string; connectionId?: undefined });

const ownerColumn = (owner: Owner) => (owner.connectionId ? "connection_id" : "import_id");
const ownerId = (owner: Owner) => owner.connectionId ?? owner.importId;
const key = (e: Pick<EntityInput, "kind" | "providerId">) => `${e.kind}:${e.providerId}`;
const MAX_TEXT = 500;
const clip = (text: string | undefined, max = MAX_TEXT) => (text ? text.slice(0, max) : null);

/**
 * Upserts entities under `provider` and returns their row ids by "kind:providerId". For open
 * sources, rows carrying a MusicBrainz id or ISRC are linked to a canonical recording.
 */
export async function upsertEntities(sql: Sql, provider: string, entities: EntityInput[], policySource = provider): Promise<Map<string, string>> {
  const unique = new Map<string, EntityInput>();
  for (const e of entities) unique.set(key(e), e);
  if (!unique.size) return new Map();
  const open = isOpen(policySource);
  const rows = [...unique.values()].map((e) => ({
    kind: e.kind, provider_id: e.providerId.slice(0, 300), title: clip(e.title), artists: (e.artists ?? []).slice(0, 20).map((a) => a.slice(0, 200)),
    album: clip(e.album), duration_ms: e.durationMs && e.durationMs > 0 && e.durationMs < 86_400_000 ? e.durationMs : null,
    // Identifiers that could tie a display-only source to another service are not kept at all.
    isrc: open ? e.isrc ?? null : null, mbid: open ? e.mbid ?? null : null, url: clip(e.url, 1000), image_url: clip(e.imageUrl, 1000),
  }));
  const stored = await sql.query<{ id: string; kind: EntityKind; provider_id: string }>(
    `INSERT INTO provider_entities (provider, kind, provider_id, title, artists, album, duration_ms, isrc, mbid, url, image_url)
     SELECT $1, r.kind, r.provider_id, r.title, r.artists, r.album, r.duration_ms, r.isrc, r.mbid, r.url, r.image_url
     FROM jsonb_to_recordset($2::jsonb) AS r(kind text, provider_id text, title text, artists jsonb, album text, duration_ms integer, isrc text, mbid text, url text, image_url text)
     ON CONFLICT (provider, kind, provider_id) DO UPDATE SET
       title = EXCLUDED.title, artists = EXCLUDED.artists, album = COALESCE(EXCLUDED.album, provider_entities.album),
       duration_ms = COALESCE(EXCLUDED.duration_ms, provider_entities.duration_ms), isrc = COALESCE(EXCLUDED.isrc, provider_entities.isrc),
       mbid = COALESCE(EXCLUDED.mbid, provider_entities.mbid), url = COALESCE(EXCLUDED.url, provider_entities.url),
       image_url = COALESCE(EXCLUDED.image_url, provider_entities.image_url), fetched_at = now()
     RETURNING id, kind, provider_id`, [provider, JSON.stringify(rows)]);
  const ids = new Map(stored.map((row) => [`${row.kind}:${row.provider_id}`, row.id]));
  if (open && rows.some((row) => row.mbid || row.isrc)) await linkCanonical(sql, [...ids.values()]);
  return ids;
}

/**
 * Links entities to canonical recordings by exact identifier only: MusicBrainz id first, then ISRC.
 * Two rows that merely share a title and artist are never joined; they may be different recordings
 * (a live take, a remaster, a cover), and without an identifier nothing says which.
 */
export async function linkCanonical(sql: Sql, entityIds: string[]): Promise<void> {
  const scope = "pe.id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb)) AND pe.canonical_id IS NULL";
  const ids = [JSON.stringify(entityIds)];
  const byMbid = `UPDATE provider_entities pe SET canonical_id = c.id, match_method = 'mbid' FROM canonical_entities c WHERE ${scope} AND pe.mbid IS NOT NULL AND c.kind = pe.kind AND c.mbid = pe.mbid`;
  const byIsrc = `UPDATE provider_entities pe SET canonical_id = c.id, match_method = 'isrc' FROM canonical_entities c WHERE ${scope} AND pe.isrc IS NOT NULL AND c.kind = pe.kind AND c.isrc = pe.isrc AND (pe.mbid IS NULL OR c.mbid IS NULL OR pe.mbid = c.mbid)`;
  await sql.query(byMbid, ids);
  await sql.query(byIsrc, ids);
  await sql.query(
    `INSERT INTO canonical_entities (kind, mbid, title, artist)
     SELECT DISTINCT ON (pe.kind, pe.mbid) pe.kind, pe.mbid, pe.title, COALESCE(pe.artists->>0, '') FROM provider_entities pe WHERE ${scope} AND pe.mbid IS NOT NULL
     ON CONFLICT DO NOTHING`, ids);
  await sql.query(byMbid, ids);
  await sql.query(
    `INSERT INTO canonical_entities (kind, isrc, title, artist)
     SELECT DISTINCT ON (pe.kind, pe.isrc) pe.kind, pe.isrc, pe.title, COALESCE(pe.artists->>0, '') FROM provider_entities pe WHERE ${scope} AND pe.isrc IS NOT NULL
     ON CONFLICT DO NOTHING`, ids);
  await sql.query(byIsrc, ids);
  // A recording first seen with only an MBID learns its ISRC from a later row that has both, so an
  // ISRC-only row from another source can find it. Skipped if another recording already has that ISRC.
  await sql.query(
    `UPDATE canonical_entities c SET isrc = pe.isrc FROM provider_entities pe
     WHERE pe.id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb)) AND pe.canonical_id = c.id AND pe.match_method = 'mbid'
       AND pe.isrc IS NOT NULL AND c.isrc IS NULL AND NOT EXISTS (SELECT 1 FROM canonical_entities o WHERE o.kind = c.kind AND o.isrc = pe.isrc)`, ids);
}

export type Applied = { library: number; playlists: number; playlistItems: number; plays: number; newPlays: number };

/** Stores one step's mutations for `owner`. Call inside a transaction together with the cursor update. */
export async function applyMutations(sql: Sql, owner: Owner, mutations: Mutation[], generation: number): Promise<Applied> {
  const applied: Applied = { library: 0, playlists: 0, playlistItems: 0, plays: 0, newPlays: 0 };
  if (!mutations.length) return applied;
  const column = ownerColumn(owner), id = ownerId(owner);
  const entities: EntityInput[] = [];
  for (const m of mutations) {
    if (m.type === "library" || m.type === "play") entities.push(m.entity);
    else if (m.type === "playlist_items") entities.push(...m.items.map((item) => item.entity));
    else if (m.type === "now_playing" && m.entity) entities.push(m.entity);
  }
  // Export IDs and metadata belong to the uploading user, not a global provider catalog.
  // A second user's file must never overwrite another user's title, album or other private data.
  const entitySource = owner.importId ? `${owner.source}:${owner.userId}` : owner.source;
  const ids = await upsertEntities(sql, entitySource, entities, owner.source);
  const entityId = (e: EntityInput) => ids.get(key(e))!;

  const library = new Map<string, { entity_id: string; relation: Relation; period: string; position: number | null; added_at: string | null }>();
  for (const m of mutations) {
    if (m.type !== "library") continue;
    const row = { entity_id: entityId(m.entity), relation: m.relation, period: m.period ?? "", position: m.position ?? null, added_at: m.addedAt ?? null };
    library.set(`${row.relation}:${row.period}:${row.entity_id}`, row);
  }
  if (library.size) {
    await sql.query(
      `INSERT INTO library_items (user_id, ${column}, entity_id, relation, period, position, added_at, generation)
       SELECT $1::uuid, $2::uuid, r.entity_id, r.relation, r.period, r.position, r.added_at, $4
       FROM jsonb_to_recordset($3::jsonb) AS r(entity_id uuid, relation text, period text, position integer, added_at timestamptz)
       ON CONFLICT (${column}, relation, period, entity_id) WHERE ${column} IS NOT NULL
       DO UPDATE SET generation = EXCLUDED.generation, position = EXCLUDED.position, added_at = COALESCE(EXCLUDED.added_at, library_items.added_at)`,
      [owner.userId, id, JSON.stringify([...library.values()]), generation]);
    applied.library = library.size;
  }

  const playlists = new Map<string, Record<string, unknown>>();
  for (const m of mutations) {
    if (m.type !== "playlist") continue;
    const p = m.playlist;
    playlists.set(p.providerId, {
      provider_playlist_id: p.providerId.slice(0, 300), name: clip(p.name), description: clip(p.description, 2000), url: clip(p.url, 1000), image_url: clip(p.imageUrl, 1000),
      owner_name: clip(p.ownerName, 200), owned: p.owned, track_count: p.trackCount ?? null, snapshot: clip(p.snapshot),
    });
  }
  if (playlists.size) {
    await sql.query(
      `INSERT INTO playlists (user_id, ${column}, provider_playlist_id, name, description, url, image_url, owner_name, owned, track_count, snapshot, generation)
       SELECT $1::uuid, $2::uuid, r.provider_playlist_id, r.name, r.description, r.url, r.image_url, r.owner_name, r.owned, r.track_count, r.snapshot, $4
       FROM jsonb_to_recordset($3::jsonb) AS r(provider_playlist_id text, name text, description text, url text, image_url text, owner_name text, owned boolean, track_count integer, snapshot text)
       ON CONFLICT (${column}, provider_playlist_id) WHERE ${column} IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, url = EXCLUDED.url, image_url = EXCLUDED.image_url, owner_name = EXCLUDED.owner_name,
         owned = EXCLUDED.owned, track_count = EXCLUDED.track_count, snapshot = EXCLUDED.snapshot, generation = EXCLUDED.generation, updated_at = now()`,
      [owner.userId, id, JSON.stringify([...playlists.values()]), generation]);
    applied.playlists = playlists.size;
  }

  for (const m of mutations) {
    if (m.type !== "playlist_items" && m.type !== "playlist_done") continue;
    const [playlist] = await sql.query<{ id: string }>(`SELECT id FROM playlists WHERE ${column} = $1 AND provider_playlist_id = $2`, [id, m.playlistId]);
    if (!playlist) continue;
    if (m.type === "playlist_done") {
      await sql.query("DELETE FROM playlist_items WHERE playlist_id = $1 AND position >= $2", [playlist.id, m.count]);
      await sql.query("UPDATE playlists SET synced_snapshot = snapshot WHERE id = $1", [playlist.id]);
      continue;
    }
    const rows = m.items.map((item, index) => ({ position: m.offset + index, entity_id: entityId(item.entity), added_at: item.addedAt ?? null }));
    await sql.query("DELETE FROM playlist_items WHERE playlist_id = $1 AND position >= $2 AND position < $3", [playlist.id, m.offset, m.offset + rows.length]);
    if (rows.length) {
      await sql.query(
        `INSERT INTO playlist_items (playlist_id, position, entity_id, added_at)
         SELECT $1::uuid, r.position, r.entity_id, r.added_at FROM jsonb_to_recordset($2::jsonb) AS r(position integer, entity_id uuid, added_at timestamptz)`,
        [playlist.id, JSON.stringify(rows)]);
    }
    applied.playlistItems += rows.length;
  }

  const plays = mutations.flatMap((m) => (m.type === "play" ? [{ entity_id: entityId(m.entity), played_at: m.playedAt, ms_played: m.msPlayed ?? null }] : []));
  if (plays.length) {
    // The unique index decides what a duplicate is: same source, same track, same instant.
    const inserted = await sql.query(
      `INSERT INTO listening_events (user_id, ${column}, entity_id, played_at, ms_played)
       SELECT $1::uuid, $2::uuid, r.entity_id, r.played_at, r.ms_played FROM jsonb_to_recordset($3::jsonb) AS r(entity_id uuid, played_at timestamptz, ms_played integer)
       ON CONFLICT DO NOTHING RETURNING 1`, [owner.userId, id, JSON.stringify(plays)]);
    applied.plays = plays.length;
    applied.newPlays = inserted.length;
  }

  const playing = mutations.filter((m) => m.type === "now_playing").pop();
  if (playing?.type === "now_playing" && owner.connectionId) {
    await sql.query(
      `INSERT INTO now_playing (connection_id, user_id, entity_id, checked_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (connection_id) DO UPDATE SET entity_id = EXCLUDED.entity_id, checked_at = now()`,
      [owner.connectionId, owner.userId, playing.entity ? entityId(playing.entity) : null]);
  }
  return applied;
}

/**
 * Ends a snapshot pass: whatever this pass didn't see is no longer in the user's library upstream,
 * so it's removed here too. Returns how many rows went.
 */
export async function removeUnseen(sql: Sql, connectionId: string, owns: { relation: Relation; period?: string; kind: EntityKind }[] | "playlists", generation: number): Promise<number> {
  if (owns === "playlists") {
    return (await sql.query("DELETE FROM playlists WHERE connection_id = $1 AND generation < $2 RETURNING 1", [connectionId, generation])).length;
  }
  let removed = 0;
  for (const own of owns) {
    removed += (await sql.query(
      `DELETE FROM library_items li USING provider_entities pe
       WHERE li.connection_id = $1 AND li.relation = $2 AND li.period = $3 AND li.generation < $4 AND pe.id = li.entity_id AND pe.kind = $5 RETURNING 1`,
      [connectionId, own.relation, own.period ?? "", generation, own.kind])).length;
  }
  return removed;
}

/** Catalogue rows of a source that no user's data points at any more. */
export async function deleteOrphans(sql: Sql, source: string | null = null): Promise<void> {
  await sql.query(
    `DELETE FROM provider_entities pe WHERE ($1::text IS NULL OR pe.provider = $1)
       AND NOT EXISTS (SELECT 1 FROM library_items x WHERE x.entity_id = pe.id)
       AND NOT EXISTS (SELECT 1 FROM playlist_items x WHERE x.entity_id = pe.id)
       AND NOT EXISTS (SELECT 1 FROM listening_events x WHERE x.entity_id = pe.id)
       AND NOT EXISTS (SELECT 1 FROM now_playing x WHERE x.entity_id = pe.id)`, [source]);
  await sql.query("DELETE FROM canonical_entities c WHERE NOT EXISTS (SELECT 1 FROM provider_entities pe WHERE pe.canonical_id = c.id)");
}
