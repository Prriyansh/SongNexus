// Uploaded exports, server side. The browser parses the file (./import-formats.ts) and sends rows
// in batches; every row is validated again here. Rows are staged under the import and stay
// invisible until the user confirms it; cancelling or deleting an import removes everything it
// brought, and nothing else. Each import records the file's name, format and SHA-256, so its
// provenance is kept and the same file can't be committed twice.

import { ApiProblem } from "../accounts/http";
import { sha256 } from "../accounts/crypto";
import type { Db, Sql } from "../db";
import { iso } from "../db";
import { publish } from "./events";
import { IMPORT_FORMATS, MAX_IMPORT_ROWS, toIso } from "./import-formats";
import { sourceDataUse } from "./policy";
import { isrc, mbid, textId } from "./providers/shared";
import { applyMutations, deleteOrphans } from "./store";
import type { EntityInput, EntityKind, ImportStats, ImportView, Mutation } from "./types";

export const MAX_BATCH = 2500;
const MAX_STAGING = 3;
const KINDS: EntityKind[] = ["track", "album", "artist"];

type ImportRecord = { id: string; user_id: string; format: string; filename: string; sha256: string; status: "staging" | "committed"; stats: ImportStats; created_at: unknown; committed_at: unknown };

const view = (row: ImportRecord): ImportView => ({
  id: row.id, format: row.format, formatLabel: IMPORT_FORMATS[row.format]?.label ?? row.format, filename: row.filename, status: row.status, stats: row.stats ?? {},
  createdAt: iso(row.created_at)!, committedAt: iso(row.committed_at), use: sourceDataUse(`import:${row.format}`),
});

const text = (value: unknown, max = 500) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** One row as mutations, or null if it isn't a valid row. Ids are namespaced by what the entity is. */
function toMutation(row: unknown, positions: Map<string, number>): Mutation[] | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const title = text(r.title), artist = text(r.artist), album = text(r.album) || undefined;
  if (!title) return null;
  const entity = (kind: EntityKind): EntityInput => ({
    kind, providerId: text(r.id, 200) || textId(kind, artist, title), title, artists: artist ? [artist] : [], album: kind === "track" ? album : undefined,
    isrc: isrc(r.isrc), mbid: mbid(r.mbid),
  });
  if (r.t === "play") {
    const playedAt = toIso(r.playedAt);
    if (!playedAt) return null;
    const ms = typeof r.msPlayed === "number" && r.msPlayed >= 0 && r.msPlayed < 86_400_000 ? Math.round(r.msPlayed) : undefined;
    return [{ type: "play", entity: entity("track"), playedAt, msPlayed: ms }];
  }
  if (r.t === "library") {
    if (!KINDS.includes(r.kind as EntityKind) || (r.relation !== "saved" && r.relation !== "favorite")) return null;
    return [{ type: "library", relation: r.relation, entity: entity(r.kind as EntityKind), addedAt: toIso(r.addedAt) }];
  }
  if (r.t === "playlist_track") {
    const name = text(r.playlist, 200);
    if (!name) return null;
    const id = textId("playlist", name);
    const offset = positions.get(id) ?? 0;
    positions.set(id, offset + 1);
    return [
      { type: "playlist", playlist: { providerId: id, name, owned: true, snapshot: "import" } },
      { type: "playlist_items", playlistId: id, offset, items: [{ entity: entity("track"), addedAt: toIso(r.addedAt) }] },
    ];
  }
  return null;
}

async function owned(sql: Sql, userId: string, importId: string, lock = false): Promise<ImportRecord> {
  const valid = /^[0-9a-f-]{36}$/i.test(importId);
  const [row] = valid ? await sql.query<ImportRecord>(`SELECT * FROM imports WHERE id = $1 AND user_id = $2${lock ? " FOR UPDATE" : ""}`, [importId, userId]) : [];
  if (!row) throw new ApiProblem("That import wasn’t found.", 404);
  return row;
}

/** Opens an import. Refuses a file (by SHA-256) this user has already imported. */
export async function createImport(db: Db, userId: string, input: Record<string, unknown>): Promise<ImportView> {
  const format = text(input.format, 60), filename = text(input.filename, 200) || "upload", hash = text(input.sha256, 64).toLowerCase();
  if (!Object.hasOwn(IMPORT_FORMATS, format)) throw new ApiProblem("Song Nexus doesn’t recognise that kind of export.", 400);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new ApiProblem("The file’s fingerprint is missing.", 400);
  return db.tx(async (sql) => {
    const [duplicate] = await sql.query<ImportRecord>("SELECT * FROM imports WHERE user_id = $1 AND sha256 = $2 AND status = 'committed'", [userId, hash]);
    if (duplicate) throw new ApiProblem(`You already imported this exact file${iso(duplicate.committed_at) ? ` on ${iso(duplicate.committed_at)!.slice(0, 10)}` : ""}. Delete that import first if you want to load it again.`, 409, { duplicateOf: duplicate.id });
    // Abandoned previews don't pile up: starting a new one keeps only the most recent few.
    await sql.query(
      `DELETE FROM imports WHERE user_id = $1 AND status = 'staging' AND (sha256 = $2 OR id NOT IN (
         SELECT id FROM imports WHERE user_id = $1 AND status = 'staging' ORDER BY created_at DESC LIMIT ${MAX_STAGING - 1}))`, [userId, hash]);
    const [row] = await sql.query<ImportRecord>("INSERT INTO imports (user_id, format, filename, sha256) VALUES ($1, $2, $3, $4) RETURNING *", [userId, format, filename, hash]);
    return view(row);
  });
}

/** Stages one batch of rows. Idempotent: sending the same batch twice stores it once. */
export async function addImportRows(db: Db, userId: string, importId: string, rows: unknown, batch?: unknown): Promise<ImportView> {
  if (!Array.isArray(rows) || !rows.length) throw new ApiProblem("Send a list of rows.", 400);
  if (rows.length > MAX_BATCH) throw new ApiProblem(`Send at most ${MAX_BATCH} rows at a time.`, 413);
  return db.tx(async (sql) => {
    const record = await owned(sql, userId, importId, true);
    if (record.status !== "staging") throw new ApiProblem("That import is already finished.", 409);
    const fingerprint = sha256(JSON.stringify(rows));
    if (batch !== undefined && (!Number.isSafeInteger(batch) || Number(batch) < 0)) throw new ApiProblem("Invalid batch number.", 400);
    const batchKey = batch === undefined ? fingerprint : String(batch);
    const [previous] = await sql.query<{ fingerprint: string }>("SELECT fingerprint FROM import_batches WHERE import_id = $1 AND batch_key = $2", [importId, batchKey]);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ApiProblem("This batch was already received with different rows.", 409);
      return view(record);
    }
    await sql.query("INSERT INTO import_batches (import_id, batch_key, fingerprint) VALUES ($1, $2, $3)", [importId, batchKey, fingerprint]);
    const stats: ImportStats = { received: 0, plays: 0, library: 0, playlists: 0, duplicates: 0, rejected: 0, ...record.stats };
    if ((stats.received ?? 0) + rows.length > MAX_IMPORT_ROWS) throw new ApiProblem("That import is too large. Split the file and import the parts.", 413);
    // Playlist positions continue from what earlier batches stored.
    const counts = await sql.query<{ provider_playlist_id: string; n: number }>(
      "SELECT p.provider_playlist_id, count(pi.position)::int AS n FROM playlists p LEFT JOIN playlist_items pi ON pi.playlist_id = p.id WHERE p.import_id = $1 GROUP BY 1", [importId]);
    const positions = new Map(counts.map((c) => [c.provider_playlist_id, c.n]));
    const mutations: Mutation[] = [];
    let rejected = 0;
    for (const row of rows) {
      const made = toMutation(row, positions);
      if (!made) { rejected++; continue; }
      for (const m of made) {
        // Consecutive tracks of one playlist travel as one batch instead of a statement each.
        const last = mutations[mutations.length - 1];
        if (m.type === "playlist_items" && last?.type === "playlist_items" && last.playlistId === m.playlistId && last.offset + last.items.length === m.offset) last.items.push(...m.items);
        else if (m.type === "playlist" && mutations.some((x) => x.type === "playlist" && x.playlist.providerId === m.playlist.providerId)) continue;
        else mutations.push(m);
      }
    }
    const applied = await applyMutations(sql, { userId, importId, source: `import:${record.format}` }, mutations, 0);
    // A play this user already has from an earlier import of the same kind (an older export of the
    // same history) is a duplicate. A second play of the same song at another time is not.
    const overlapping = await sql.query(
      `DELETE FROM listening_events le USING listening_events old, imports oi
       WHERE le.import_id = $1 AND old.user_id = le.user_id AND old.entity_id = le.entity_id AND old.played_at = le.played_at
         AND old.import_id <> le.import_id AND oi.id = old.import_id AND oi.status = 'committed' AND oi.format = $2 RETURNING 1`, [importId, record.format]);
    const [range] = await sql.query<{ oldest: unknown; newest: unknown; plays: number }>("SELECT min(played_at) AS oldest, max(played_at) AS newest, count(*)::int AS plays FROM listening_events WHERE import_id = $1", [importId]);
    const [{ n: library }] = await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM library_items WHERE import_id = $1", [importId]);
    const [{ n: playlists }] = await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM playlists WHERE import_id = $1", [importId]);
    const next: ImportStats = {
      received: (stats.received ?? 0) + rows.length, rejected: (stats.rejected ?? 0) + rejected,
      duplicates: (stats.duplicates ?? 0) + (applied.plays - applied.newPlays) + overlapping.length,
      plays: range.plays, library, playlists, oldest: iso(range.oldest), newest: iso(range.newest),
    };
    const [updated] = await sql.query<ImportRecord>("UPDATE imports SET stats = $2::jsonb WHERE id = $1 RETURNING *", [importId, JSON.stringify(next)]);
    return view(updated);
  });
}

/** Makes a staged import part of the user's library. */
export async function commitImport(db: Db, userId: string, importId: string): Promise<ImportView> {
  return db.tx(async (sql) => {
    const record = await owned(sql, userId, importId, true);
    if (record.status === "committed") return view(record);
    const stored = (record.stats.plays ?? 0) + (record.stats.library ?? 0) + (record.stats.playlists ?? 0);
    if (!stored) throw new ApiProblem(record.stats.duplicates ? "Everything in that file is already in your library from an earlier import." : "That import has nothing in it yet.", 409);
    const [duplicate] = await sql.query("SELECT 1 FROM imports WHERE user_id = $1 AND sha256 = $2 AND status = 'committed'", [userId, record.sha256]);
    if (duplicate) throw new ApiProblem("You already imported this exact file.", 409);
    for (const playlist of await sql.query<{ id: string }>("SELECT id FROM playlists WHERE import_id = $1", [importId])) {
      await sql.query("UPDATE playlists SET synced_snapshot = snapshot, track_count = (SELECT count(*)::int FROM playlist_items WHERE playlist_id = $1) WHERE id = $1", [playlist.id]);
    }
    const [updated] = await sql.query<ImportRecord>("UPDATE imports SET status = 'committed', committed_at = now() WHERE id = $1 RETURNING *", [importId]);
    await publish(sql, userId, "import", { import: importId, change: "committed" });
    return view(updated);
  });
}

export async function listImports(sql: Sql, userId: string): Promise<ImportView[]> {
  return (await sql.query<ImportRecord>("SELECT * FROM imports WHERE user_id = $1 AND status = 'committed' ORDER BY committed_at DESC", [userId])).map(view);
}

/** Cancels a preview or rolls back a finished import: its rows go, and only its rows. */
export async function deleteImport(db: Db, userId: string, importId: string): Promise<void> {
  await db.tx(async (sql) => {
    const record = await owned(sql, userId, importId, true);
    await sql.query("DELETE FROM imports WHERE id = $1", [importId]);
    await deleteOrphans(sql, `import:${record.format}:${userId}`);
    await publish(sql, userId, "import", { import: importId, change: "deleted" });
  });
}
