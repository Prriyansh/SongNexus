// The sync job queue, in Postgres. A partial unique index allows one queued-or-running job per
// connection, so a double click, two browser tabs and the scheduler can all ask at once and still
// produce a single job. Workers claim with FOR UPDATE SKIP LOCKED and hold a lease; a job whose
// worker died is picked up again when its lease runs out, which is also how work resumes after a
// restart or a serverless function ending mid-sync.

import type { Sql } from "../db";
import { iso } from "../db";
import type { JobView } from "./types";

export type JobRow = { id: string; lease_token: string; connection_id: string; user_id: string; kind: JobView["kind"]; status: JobView["status"]; attempts: number; progress: JobView["progress"]; error: string | null; created_at: unknown; finished_at: unknown; run_after: unknown };
const COLUMNS = "id, lease_token, connection_id, user_id, kind, status, attempts, progress, error, created_at, finished_at, run_after";

export const LEASE_SECONDS = 120;
export const MAX_ATTEMPTS = 5;

export const jobView = (row: JobRow): JobView => ({
  id: row.id, kind: row.kind, status: row.status, progress: row.progress ?? {}, error: row.error,
  createdAt: iso(row.created_at)!, finishedAt: iso(row.finished_at), runAfter: iso(row.run_after),
});

/**
 * Asks for a sync. Returns the connection's active job, new or already there. A manual or initial
 * request marks every resource due. Existing retry deadlines remain in force.
 */
export async function enqueue(sql: Sql, connection: { id: string; userId: string }, kind: JobView["kind"]): Promise<{ job: JobRow; created: boolean }> {
  if (kind !== "scheduled") await sql.query("UPDATE sync_state SET next_due_at = now() WHERE connection_id = $1", [connection.id]);
  const inserted = await sql.query<JobRow>(
    `INSERT INTO sync_jobs (connection_id, user_id, kind) VALUES ($1, $2, $3)
     ON CONFLICT (connection_id) WHERE status IN ('queued', 'running') DO NOTHING RETURNING ${COLUMNS}`, [connection.id, connection.userId, kind]);
  if (inserted.length) return { job: inserted[0], created: true };
  const [job] = await sql.query<JobRow>(`SELECT ${COLUMNS} FROM sync_jobs WHERE connection_id = $1 AND status IN ('queued', 'running')`, [connection.id]);
  return { job, created: false };
}

/** Queues a job for every connection with something due. Safe to call from anywhere, any number of times. */
export async function scheduleDue(sql: Sql, userId: string | null = null): Promise<number> {
  const rows = await sql.query(
    `INSERT INTO sync_jobs (connection_id, user_id, kind)
     SELECT c.id, c.user_id, 'scheduled' FROM connections c
     WHERE c.status IN ('connected', 'error') AND ($1::uuid IS NULL OR c.user_id = $1::uuid)
       AND (NOT EXISTS (SELECT 1 FROM sync_state s WHERE s.connection_id = c.id)
         OR EXISTS (SELECT 1 FROM sync_state s WHERE s.connection_id = c.id AND s.next_due_at <= now()))
     ON CONFLICT (connection_id) WHERE status IN ('queued', 'running') DO NOTHING RETURNING 1`, [userId]);
  return rows.length;
}

/** Takes the next runnable job, or one whose lease expired. Null when there's nothing to do. */
export async function claim(sql: Sql, userId: string | null = null): Promise<JobRow | null> {
  const [job] = await sql.query<JobRow>(
    `UPDATE sync_jobs SET
       attempts = attempts + CASE WHEN status = 'running' THEN 1 ELSE 0 END,
       status = 'running', lease_token = gen_random_uuid(), started_at = COALESCE(started_at, now()), lease_until = now() + make_interval(secs => $1)
     WHERE id = (
       SELECT id FROM sync_jobs
       WHERE ((status = 'queued' AND run_after <= now()) OR (status = 'running' AND lease_until < now()))
         AND ($2::uuid IS NULL OR user_id = $2::uuid)
       ORDER BY run_after LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING ${COLUMNS}`, [LEASE_SECONDS, userId]);
  return job ?? null;
}

export const extendLease = (sql: Sql, jobId: string, progress: JobView["progress"], token?: string) =>
  sql.query("UPDATE sync_jobs SET lease_until = now() + make_interval(secs => $2), progress = $3::jsonb WHERE id = $1 AND ($4::uuid IS NULL OR (lease_token = $4 AND status = 'running'))", [jobId, LEASE_SECONDS, JSON.stringify(progress), token ?? null]);

/** Back to the queue: to continue after a time budget, or to wait out a rate limit or a backoff. */
export const requeue = (sql: Sql, jobId: string, delaySeconds: number, error: string | null = null, failed = false, token?: string) =>
  sql.query(
    `UPDATE sync_jobs SET status = 'queued', lease_until = NULL, run_after = now() + make_interval(secs => $2), error = $3,
       attempts = attempts + $4 WHERE id = $1 AND ($5::uuid IS NULL OR (lease_token = $5 AND status = 'running'))`, [jobId, Math.max(0, Math.round(delaySeconds)), error, failed ? 1 : 0, token ?? null]);

export const finish = (sql: Sql, jobId: string, status: "succeeded" | "failed" | "cancelled", error: string | null = null, token?: string) =>
  sql.query("UPDATE sync_jobs SET status = $2, error = $3, lease_until = NULL, finished_at = now() WHERE id = $1 AND ($4::uuid IS NULL OR (lease_token = $4 AND status = 'running'))", [jobId, status, error, token ?? null]);

export async function latestJobs(sql: Sql, userId: string): Promise<Map<string, JobRow>> {
  const rows = await sql.query<JobRow>(
    `SELECT DISTINCT ON (connection_id) ${COLUMNS} FROM sync_jobs WHERE user_id = $1
     ORDER BY connection_id, (status IN ('queued', 'running')) DESC, created_at DESC`, [userId]);
  return new Map(rows.map((row) => [row.connection_id, row]));
}
