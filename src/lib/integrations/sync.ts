// The sync engine. A job covers one connection; it walks the adapter's resources that are due,
// one step (one page, usually one request) at a time. After every step the rows it produced and
// the cursor are committed together, so stopping anywhere — a time budget, a crash, a rate limit —
// loses nothing and the next run continues from the same page.
//
// How failures are handled:
//   rate limited         the job goes back to the queue until the provider's Retry-After has passed
//   401                  one refresh-and-retry; if that fails the connection waits for the user
//   403 on one resource  that resource is marked and skipped; the others still sync
//   network / 5xx        retried in ./http.ts, then the job backs off (1, 2, 4… minutes) up to 5 tries
//
// Nothing here knows about a specific provider.

import { redact } from "../accounts/crypto";
import { pruneExpired } from "../accounts/users";
import type { Db, Sql } from "../db";
import { credentials, markReauth, requester } from "./connections";
import type { Deps, LiveConnection } from "./connections";
import { publish } from "./events";
import { AccessDeniedError, ProviderError, RateLimitedError, ReauthRequiredError } from "./http";
import { claim, extendLease, finish, LEASE_SECONDS, MAX_ATTEMPTS, requeue, scheduleDue } from "./jobs";
import type { JobRow } from "./jobs";
import { POLICIES } from "./policy";
import { adapter } from "./registry";
import { applyMutations, deleteOrphans, removeUnseen } from "./store";
import type { Json, ProviderAdapter, StepContext, StepResult, SyncResource } from "./types";

/** A resource that can't be read (403) is looked at again this often, in case access was granted. */
const DENIED_RETRY_MINUTES = 360;
/** A guard against a provider that never stops paging. 5,000 steps is a million scrobbles. */
const MAX_STEPS_PER_RUN = 5000;

type State = { page_cursor: Json | null; checkpoint: Json | null; generation: number; items: number };
type Outcome = "done" | "yield";
class LeaseLost extends Error {}
async function assertLease(sql: Sql, job: JobRow): Promise<void> {
  const rows = await sql.query("SELECT 1 FROM sync_jobs WHERE id = $1 AND lease_token = $2 AND status = 'running' AND lease_until > now() FOR UPDATE", [job.id, job.lease_token]);
  if (!rows.length) throw new LeaseLost();
}

const message = (error: unknown) => redact(error instanceof Error ? error.message : String(error)).slice(0, 300);

function stepContext(db: Db, a: ProviderAdapter, live: LiveConnection, deps: Deps): StepContext {
  const env = deps.env ?? process.env;
  const request = requester(a, deps);
  return {
    env, credentials: live.credentials, profile: { id: live.providerUserId, name: live.displayName }, now: deps.now ?? Date.now,
    get: (url, init = {}, options) => request(url, { ...init, headers: { ...a.authHeaders(live.credentials, env), ...init.headers } }, options),
    pendingPlaylists: async () => (await db.query<{ provider_playlist_id: string; snapshot: string | null }>(
      "SELECT provider_playlist_id, snapshot FROM playlists WHERE connection_id = $1 AND snapshot IS NOT NULL AND synced_snapshot IS DISTINCT FROM snapshot ORDER BY provider_playlist_id", [live.id]))
      .map((row) => ({ providerId: row.provider_playlist_id, snapshot: row.snapshot })),
  };
}

/** Runs one resource until its pass is finished or the deadline passes. */
async function runResource(db: Db, job: JobRow, a: ProviderAdapter, resource: SyncResource, deps: Deps, deadline: number, progress: JobRow["progress"]): Promise<Outcome> {
  const now = deps.now ?? Date.now;
  await db.query("INSERT INTO sync_state (connection_id, resource) VALUES ($1, $2) ON CONFLICT DO NOTHING", [job.connection_id, resource.key]);
  let refreshed = false;
  for (let steps = 0; steps < MAX_STEPS_PER_RUN; steps++) {
    const live = await credentials(db, job.connection_id, deps);
    if (!live) return "done";
    const [state] = await db.query<State>("SELECT page_cursor, checkpoint, generation, items FROM sync_state WHERE connection_id = $1 AND resource = $2", [job.connection_id, resource.key]);
    // No cursor means a new pass: it gets the next generation, which is how removals are noticed.
    const starting = state.page_cursor === null;
    const generation = starting ? state.generation + 1 : state.generation;
    let result: StepResult;
    try {
      result = await resource.step(stepContext(db, a, live, deps), { cursor: state.page_cursor, checkpoint: state.checkpoint });
    } catch (error) {
      if (!(error instanceof ReauthRequiredError) || refreshed) throw error;
      // The token may simply have expired early: refresh once and try the same step again.
      refreshed = true;
      await credentials(db, job.connection_id, deps, true);
      continue;
    }
    const finished = result.next === null;
    const stored = await db.tx(async (sql) => {
      await assertLease(sql, job);
      const applied = await applyMutations(sql, { userId: job.user_id, connectionId: job.connection_id, source: a.id }, result.mutations, generation);
      const count = applied.library + applied.playlists + applied.newPlays;
      if (!finished) {
        await sql.query("UPDATE sync_state SET page_cursor = $3::jsonb, generation = $4, items = $5 WHERE connection_id = $1 AND resource = $2",
          [job.connection_id, resource.key, JSON.stringify(result.next), generation, (starting && resource.mode === "snapshot" ? 0 : state.items) + count]);
        return count;
      }
      if (resource.mode === "snapshot" && resource.owns) await removeUnseen(sql, job.connection_id, resource.owns, generation);
      await sql.query(
        `UPDATE sync_state SET page_cursor = NULL, generation = $3, items = $4, checkpoint = CASE WHEN $5::boolean THEN $6::jsonb ELSE checkpoint END,
           last_success_at = now(), last_error = NULL, next_due_at = now() + make_interval(mins => $7) WHERE connection_id = $1 AND resource = $2`,
        [job.connection_id, resource.key, generation, (starting && resource.mode === "snapshot" ? 0 : state.items) + count,
          result.checkpoint !== undefined, JSON.stringify(result.checkpoint ?? null), resource.intervalMinutes]);
      if (count) await publish(sql, job.user_id, "library", { provider: a.id, resource: resource.key });
      return count;
    });
    progress.resource = resource.key;
    progress.label = resource.label;
    progress.stored = (progress.stored ?? 0) + stored;
    await extendLease(db, job.id, progress, job.lease_token);
    await publish(db, job.user_id, "sync", { provider: a.id, connection: job.connection_id, job: job.id, status: "running", ...progress });
    if (finished) return "done";
    if (now() >= deadline) return "yield";
  }
  return "yield";
}

/** Runs a claimed job until it's finished, has to wait, or `deadline` passes. */
export async function runJob(db: Db, job: JobRow, deps: Deps = {}, deadline = Infinity): Promise<void> {
  try { await db.tx(sql => assertLease(sql, job)); } catch (error) { if (error instanceof LeaseLost) return; throw error; }
  const [connection] = await db.query<{ provider: ProviderAdapter["id"]; scopes: string[]; status: string }>("SELECT provider, scopes, status FROM connections WHERE id = $1", [job.connection_id]);
  if (!connection || connection.status === "reauth_required") { await finish(db, job.id, "cancelled", null, job.lease_token); return; }
  const a = adapter(connection.provider);
  // The marker a failed job leaves so the scheduler waits before trying again; this run is that try.
  await db.query("DELETE FROM sync_state WHERE connection_id = $1 AND resource = '_retry'", [job.connection_id]);
  const allowed = a.resources.filter((resource) => (resource.scopes ?? []).every((scope) => connection.scopes.includes(scope)));
  const due = new Set((await db.query<{ resource: string }>("SELECT resource FROM sync_state WHERE connection_id = $1 AND next_due_at > now()", [job.connection_id])).map((row) => row.resource));
  const todo = allowed.filter((resource) => !due.has(resource.key));
  const progress: JobRow["progress"] = { ...job.progress, total: Math.max(job.progress.total ?? 0, (job.progress.done ?? 0) + todo.length), done: job.progress.done ?? 0 };
  const denied: string[] = [];
  const announce = (status: string, extra: Record<string, Json> = {}) => publish(db, job.user_id, "sync", { provider: a.id, connection: job.connection_id, job: job.id, status, ...extra });
  await db.query("UPDATE connections SET last_sync_at = now() WHERE id = $1", [job.connection_id]);
  const heartbeat = setInterval(() => {
    void db.query("UPDATE sync_jobs SET lease_until = now() + make_interval(secs => $3) WHERE id = $1 AND lease_token = $2 AND status = 'running'", [job.id, job.lease_token, LEASE_SECONDS]).catch(() => {});
  }, 30_000);
  heartbeat.unref?.();
  try {
    for (const resource of todo) {
      try {
        if (await runResource(db, job, a, resource, deps, deadline, progress) === "yield") {
          // Out of time, not out of work: straight back to the queue, continuing from the stored cursor.
          await extendLease(db, job.id, progress, job.lease_token);
          await requeue(db, job.id, 0, null, false, job.lease_token);
          return;
        }
        progress.done = (progress.done ?? 0) + 1;
      } catch (error) {
        await db.tx(sql => assertLease(sql, job));
        if (!(error instanceof AccessDeniedError)) throw error;
        denied.push(error.message);
        progress.done = (progress.done ?? 0) + 1;
        await db.query("UPDATE sync_state SET page_cursor = NULL, last_error = $3, next_due_at = now() + make_interval(mins => $4) WHERE connection_id = $1 AND resource = $2",
          [job.connection_id, resource.key, message(error), DENIED_RETRY_MINUTES]);
      }
    }
    // Every resource refused: the account can't be read at all (not on the app's allowlist, no subscription).
    const blocked = todo.length > 0 && denied.length === todo.length;
    await db.query("UPDATE connections SET status = $2, last_error = $3, last_success_at = CASE WHEN $4::boolean THEN last_success_at ELSE now() END WHERE id = $1 AND status <> 'reauth_required'",
      [job.connection_id, blocked ? "error" : "connected", denied[0] ?? null, blocked]);
    await extendLease(db, job.id, progress, job.lease_token);
    await finish(db, job.id, blocked ? "failed" : "succeeded", blocked ? denied[0] : null, job.lease_token);
    await announce(blocked ? "failed" : "succeeded", blocked ? { error: denied[0] } : {});
  } catch (error) {
    if (error instanceof LeaseLost) return;
    try { await db.tx(sql => assertLease(sql, job)); } catch (leaseError) { if (leaseError instanceof LeaseLost) return; throw leaseError; }
    const text = message(error);
    if (error instanceof ReauthRequiredError) {
      await markReauth(db, job.connection_id, job.user_id, a.id, text);
      await announce("cancelled", { error: text });
    } else if (error instanceof RateLimitedError) {
      // Waiting is not failing: the attempt count stays where it was.
      await requeue(db, job.id, Math.ceil(error.retryAfterMs / 1000) + 1, text, false, job.lease_token);
      await announce("waiting", { error: text });
    } else if (job.attempts + 1 < MAX_ATTEMPTS && (!(error instanceof ProviderError) || error.retryable)) {
      await requeue(db, job.id, 60 * 2 ** job.attempts * (0.75 + Math.random() / 2), text, true, job.lease_token);
      await announce("waiting", { error: text });
    } else {
      if (!(error instanceof ProviderError)) console.error("[sync] job failed:", text);
      await finish(db, job.id, "failed", text, job.lease_token);
      await db.query("UPDATE connections SET status = 'error', last_error = $2 WHERE id = $1 AND status <> 'reauth_required'", [job.connection_id, text]);
      // Try again later rather than never: the resources come due again after the denied-retry interval.
      await db.query("UPDATE sync_state SET next_due_at = now() + make_interval(mins => $2) WHERE connection_id = $1 AND next_due_at <= now()", [job.connection_id, DENIED_RETRY_MINUTES]);
      await db.query("INSERT INTO sync_state (connection_id, resource, next_due_at, last_error) VALUES ($1, '_retry', now() + make_interval(mins => $2), $3) ON CONFLICT (connection_id, resource) DO UPDATE SET next_due_at = EXCLUDED.next_due_at, last_error = EXCLUDED.last_error",
        [job.connection_id, DENIED_RETRY_MINUTES, text]);
      await announce("failed", { error: text });
    }
  } finally { clearInterval(heartbeat); }
}

export type WorkerResult = { scheduled: number; ran: number; exhausted: boolean };

/**
 * Schedules what's due and runs jobs until there are none or the budget is spent. `userId` limits
 * it to one user's connections (used while that user has the app open).
 */
export async function runWorker(db: Db, options: { budgetMs: number; userId?: string | null; deps?: Deps }): Promise<WorkerResult> {
  const deps = options.deps ?? {}, now = deps.now ?? Date.now;
  const deadline = now() + options.budgetMs;
  const scheduled = await scheduleDue(db, options.userId ?? null);
  let ran = 0;
  while (now() < deadline) {
    const job = await claim(db, options.userId ?? null);
    if (!job) return { scheduled, ran, exhausted: true };
    await runJob(db, job, deps, deadline);
    ran++;
  }
  return { scheduled, ran, exhausted: false };
}

/** Periodic cleanup: expired sessions and states, old events and jobs, and provider data past its allowed age. */
export async function housekeeping(db: Db): Promise<void> {
  await pruneExpired(db);
  for (const [provider, policy] of Object.entries(POLICIES)) {
    if (!policy.refreshWithinDays) continue;
    // Every sync refreshes fetched_at, so only data that could not be refreshed in time is removed.
    await db.query("DELETE FROM provider_entities WHERE provider = $1 AND fetched_at < now() - make_interval(days => $2)", [provider, policy.refreshWithinDays]);
    // Playlist names/descriptions and user-specific memberships are authorized data too.
    // Another user's refresh of public catalog metadata must not extend this user's retention.
    const stale = await db.query<{ id: string }>(
      `SELECT c.id FROM connections c WHERE c.provider = $1 AND COALESCE(
        (SELECT min(s.last_success_at) FROM sync_state s WHERE s.connection_id = c.id AND s.resource <> '_retry'), c.connected_at
      ) < now() - make_interval(days => $2)`, [provider, policy.refreshWithinDays]);
    for (const { id } of stale) {
      for (const table of ['library_items', 'playlists', 'listening_events', 'now_playing']) await db.query(`DELETE FROM ${table} WHERE connection_id = $1`, [id]);
      await db.query("UPDATE sync_state SET page_cursor = NULL, checkpoint = NULL, next_due_at = now() WHERE connection_id = $1", [id]);
    }
    await db.query("DELETE FROM playlists p USING connections c WHERE p.connection_id = c.id AND c.provider = $1 AND p.updated_at < now() - make_interval(days => $2)", [provider, policy.refreshWithinDays]);
    await deleteOrphans(db, provider);
  }
  // Expired staging imports have lost their memberships; remove their private catalog rows too.
  await deleteOrphans(db);
}

const running = globalThis as { __songNexusWorker?: Promise<unknown> | null };

/**
 * Starts a worker pass in this process unless one is already going, and returns its promise.
 * Routes hand it to `after()` so it runs once the response is sent.
 */
export function kick(db: Db, options: { budgetMs: number; userId?: string | null; deps?: Deps }): Promise<unknown> {
  if (running.__songNexusWorker) return running.__songNexusWorker;
  const pass = runWorker(db, options)
    .catch((error) => console.error("[sync] worker failed:", message(error)))
    .finally(() => { running.__songNexusWorker = null; });
  running.__songNexusWorker = pass;
  return pass;
}
