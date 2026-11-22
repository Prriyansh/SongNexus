// A user's link to a music service, from "Connect" to "Disconnect":
//   beginAuthorization → the provider's consent page → completeAuthorization → stored, sealed
//   credentials → an initial sync job. Later: credentials() hands the sync engine a token that's
//   still valid, refreshing it under a row lock; disconnect() revokes and deletes.
//
// Every function takes the signed-in user's id and filters by it, so one user can't read, sync or
// remove another's connection even with its id.

import { ApiProblem } from "../accounts/http";
import { open, pkceChallenge, randomToken, redact, seal, sha256 } from "../accounts/crypto";
import type { Db, Sql } from "../db";
import { iso } from "../db";
import { publish } from "./events";
import { ProviderError, providerJson, ReauthRequiredError } from "./http";
import type { HttpOptions } from "./http";
import { enqueue, jobView, latestJobs } from "./jobs";
import { adapter, connectable } from "./registry";
import { deleteOrphans } from "./store";
import type { AdapterContext, Connected, ConnectionStatus, ConnectionView, Credentials, ProviderAdapter, ProviderId, Requester, ResourceStatus } from "./types";

type Env = Record<string, string | undefined>;
export type Deps = { env?: Env; fetchImpl?: typeof fetch; now?: () => number; sleep?: HttpOptions["sleep"] };

const STATE_MINUTES = 10;
/** Refresh this long before a token expires, so a request never starts with one about to lapse. */
const REFRESH_MARGIN_MS = 120_000;

export const callbackPath = (provider: ProviderId) => `/api/integrations/${provider}/callback`;
const credentialContext = (userId: string, provider: string) => `connection:${userId}:${provider}`;

export const requester = (a: ProviderAdapter, deps: Deps): Requester => (url, init, options) =>
  providerJson(a.name, url, init, { fetchImpl: deps.fetchImpl, sleep: deps.sleep, ...options });
const context = (a: ProviderAdapter, deps: Deps): AdapterContext => ({ env: deps.env ?? process.env, request: requester(a, deps) });

/** A provider's own failure, reworded for the person connecting. Other errors pass through. */
const asProblem = (error: unknown) =>
  error instanceof ProviderError ? new ApiProblem(error.message, error.status === 400 ? 400 : 502, { retryable: error.retryable }) : error;

function available(provider: ProviderId, env: Env): ProviderAdapter {
  const a = adapter(provider);
  if (a.blocked) throw new ApiProblem(a.blocked.note, 409);
  if (!connectable(a, env)) throw new ApiProblem(`${a.name} isn’t set up on this server.`, 503, { unavailable: true });
  return a;
}

/** Starts an OAuth sign-in: remembers a single-use state and PKCE verifier, and returns where to send the user. */
export async function beginAuthorization(db: Db, userId: string, provider: ProviderId, origin: string, deps: Deps = {}): Promise<string> {
  const env = deps.env ?? process.env;
  const a = available(provider, env);
  if (!a.authorize) throw new ApiProblem(`${a.name} isn’t connected through a sign-in page.`, 400);
  const state = randomToken(), verifier = randomToken(48);
  const redirectUri = `${origin}${callbackPath(provider)}`;
  // A user who starts twice keeps only the latest attempt.
  await db.query("DELETE FROM oauth_states WHERE user_id = $1 AND provider = $2", [userId, provider]);
  await db.query(
    "INSERT INTO oauth_states (state_hash, user_id, provider, secret, redirect_uri, expires_at) VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))",
    [sha256(state), userId, provider, seal(verifier, `oauth:${userId}:${provider}`, env), redirectUri, STATE_MINUTES]);
  return a.authorize({ env, redirectUri, state, codeChallenge: pkceChallenge(verifier) });
}

/**
 * Finishes an OAuth sign-in. The state must exist, be unexpired, belong to this user and this
 * provider, and is deleted as it's read, so a replayed or forged callback finds nothing.
 */
export async function completeAuthorization(db: Db, userId: string, provider: ProviderId, params: URLSearchParams, deps: Deps = {}): Promise<ConnectionView> {
  const env = deps.env ?? process.env;
  const a = available(provider, env);
  if (!a.handleCallback) throw new ApiProblem(`${a.name} isn’t connected through a sign-in page.`, 400);
  const state = params.get("state");
  if (!state) throw new ApiProblem("That sign-in link is incomplete. Start again from Connected Accounts.", 400);
  const [row] = await db.query<{ user_id: string; provider: string; secret: string; redirect_uri: string }>(
    "DELETE FROM oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING user_id, provider, secret, redirect_uri", [sha256(state)]);
  if (!row || row.user_id !== userId || row.provider !== provider) throw new ApiProblem("That sign-in has expired or was already used. Start again from Connected Accounts.", 400);
  if (params.get("error")) throw new ApiProblem(params.get("error") === "access_denied" ? `You didn’t approve access, so ${a.name} wasn’t connected.` : `${a.name} couldn’t complete the sign-in.`, 400);
  if (!params.get("code") && !params.get("token")) throw new ApiProblem(`${a.name} didn’t return an authorization.`, 400);
  let connected: Connected;
  try {
    connected = await a.handleCallback(context(a, deps), { redirectUri: row.redirect_uri, params, codeVerifier: open(row.secret, `oauth:${userId}:${provider}`, env) });
  } catch (error) { throw asProblem(error); }
  return saveConnection(db, userId, a, connected, env);
}

/** For providers linked with a token the user pastes, or one their browser obtained (MusicKit). */
export async function connectWithToken(db: Db, userId: string, provider: ProviderId, input: Record<string, unknown>, deps: Deps = {}): Promise<ConnectionView> {
  const env = deps.env ?? process.env;
  const a = available(provider, env);
  if (!a.connectWithToken) throw new ApiProblem(`${a.name} is connected through its sign-in page.`, 400);
  let connected: Connected;
  try {
    connected = await a.connectWithToken(context(a, deps), input);
  } catch (error) { throw asProblem(error); }
  return saveConnection(db, userId, a, connected, env);
}

async function saveConnection(db: Db, userId: string, a: ProviderAdapter, connected: Connected, env: Env): Promise<ConnectionView> {
  if (!connected.profile.id) throw new ApiProblem(`${a.name} didn’t say which account this is.`, 502);
  const sealed = seal(JSON.stringify(connected.credentials), credentialContext(userId, a.id), env);
  const expires = connected.credentials.expiresAt ? new Date(connected.credentials.expiresAt).toISOString() : null;
  const id = await db.tx(async (sql) => {
    const [existing] = await sql.query<{ id: string; provider_user_id: string }>("SELECT id, provider_user_id FROM connections WHERE user_id = $1 AND provider = $2 FOR UPDATE", [userId, a.id]);
    // Reconnecting as a different account on the same service: the old account's data goes first.
    if (existing && existing.provider_user_id !== connected.profile.id) await sql.query("DELETE FROM connections WHERE id = $1", [existing.id]);
    const [row] = await sql.query<{ id: string }>(
      `INSERT INTO connections (user_id, provider, provider_user_id, display_name, profile_url, status, scopes, credentials, access_expires_at)
       VALUES ($1, $2, $3, $4, $5, 'connected', $6::jsonb, $7, $8)
       ON CONFLICT (user_id, provider) DO UPDATE SET display_name = EXCLUDED.display_name, profile_url = EXCLUDED.profile_url, status = 'connected',
         scopes = EXCLUDED.scopes, credentials = EXCLUDED.credentials, access_expires_at = EXCLUDED.access_expires_at, last_error = NULL
       RETURNING id`,
      [userId, a.id, connected.profile.id, connected.profile.name.slice(0, 200), connected.profile.url ?? null, JSON.stringify(connected.scopes), sealed, expires]);
    await sql.query("UPDATE sync_state SET last_error = NULL WHERE connection_id = $1", [row.id]);
    const existed = Boolean(existing && existing.provider_user_id === connected.profile.id);
    await enqueue(sql, { id: row.id, userId }, existed ? "manual" : "initial");
    await publish(sql, userId, "connection", { provider: a.id, change: existed ? "reconnected" : "connected" });
    return row.id;
  });
  return (await listConnections(db, userId)).find((c) => c.id === id)!;
}

type ConnectionRow = { id: string; user_id: string; provider: ProviderId; provider_user_id: string; display_name: string; profile_url: string | null; status: "connected" | "reauth_required" | "error"; scopes: string[]; credentials: string; connected_at: unknown; last_success_at: unknown; last_error: string | null };

export async function listConnections(db: Sql, userId: string): Promise<ConnectionView[]> {
  const rows = await db.query<ConnectionRow>("SELECT * FROM connections WHERE user_id = $1 ORDER BY connected_at", [userId]);
  if (!rows.length) return [];
  const states = await db.query<{ connection_id: string; resource: string; items: number; last_success_at: unknown; next_due_at: unknown; last_error: string | null }>(
    "SELECT s.connection_id, s.resource, s.items, s.last_success_at, s.next_due_at, s.last_error FROM sync_state s JOIN connections c ON c.id = s.connection_id WHERE c.user_id = $1", [userId]);
  const jobs = await latestJobs(db, userId);
  return rows.map((row) => {
    const a = adapter(row.provider);
    const capabilities = a.capabilities(row.scopes);
    const resources: ResourceStatus[] = a.resources.map((resource) => {
      const state = states.find((s) => s.connection_id === row.id && s.resource === resource.key);
      const missing = (resource.scopes ?? []).some((scope) => !row.scopes.includes(scope));
      return {
        key: resource.key, label: resource.label, capability: resource.capability, items: state?.items ?? 0,
        lastSuccessAt: iso(state?.last_success_at), nextDueAt: iso(state?.next_due_at), error: state?.last_error ?? null,
        ...(missing ? { skipped: `${a.name} wasn’t given permission for this.` } : {}),
      };
    });
    const jobRow = jobs.get(row.id);
    const job = jobRow ? jobView(jobRow) : null;
    const active = job && (job.status === "running" || (job.status === "queued" && (!job.runAfter || Date.parse(job.runAfter) <= Date.now() + 5_000)));
    const partial = resources.some((r) => r.skipped || r.error) || Object.values(capabilities).some((c) => c.missingScope);
    const status: ConnectionStatus = row.status === "reauth_required" ? "reauth_required" : active ? "syncing" : row.status === "error" ? "error" : partial ? "partial_access" : "connected";
    return {
      id: row.id, provider: row.provider, status, displayName: row.display_name, profileUrl: row.profile_url, scopes: row.scopes, capabilities,
      connectedAt: iso(row.connected_at)!, lastSuccessAt: iso(row.last_success_at), lastError: row.last_error, resources, job,
    };
  });
}

export async function ownedConnection(sql: Sql, userId: string, connectionId: string): Promise<ConnectionRow> {
  const valid = /^[0-9a-f-]{36}$/i.test(connectionId);
  const [row] = valid ? await sql.query<ConnectionRow>("SELECT * FROM connections WHERE id = $1 AND user_id = $2", [connectionId, userId]) : [];
  // The same answer whether it doesn't exist or belongs to someone else.
  if (!row) throw new ApiProblem("That connection wasn’t found.", 404);
  return row;
}

/**
 * Disconnects: asks the provider to revoke our access where it can, then deletes the connection.
 * The cascade removes its credentials, library rows, playlists, plays, sync state and jobs, and
 * catalogue rows nobody else's data uses are cleaned up after.
 */
export async function disconnect(db: Db, userId: string, connectionId: string, deps: Deps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const row = await ownedConnection(db, userId, connectionId);
  const a = adapter(row.provider);
  if (a.disconnect) {
    try {
      await a.disconnect(context(a, deps), JSON.parse(open(row.credentials, credentialContext(userId, row.provider), env)) as Credentials);
    } catch (error) {
      // Local deletion must not depend on the provider being reachable.
      console.warn(`[integrations] ${a.name} revoke failed:`, redact(error instanceof Error ? error.message : String(error)));
    }
  }
  await db.tx(async (sql) => {
    await sql.query("DELETE FROM connections WHERE id = $1 AND user_id = $2", [connectionId, userId]);
    await deleteOrphans(sql, row.provider);
    await publish(sql, userId, "connection", { provider: row.provider, change: "disconnected" });
  });
}

export type LiveConnection = { id: string; userId: string; provider: ProviderId; providerUserId: string; displayName: string; scopes: string[]; credentials: Credentials };

/**
 * The connection with credentials that are good to use. If the access token is about to expire (or
 * `force` says the provider just rejected it), it's refreshed while holding a lock on the row, so
 * two workers can't both spend a single-use refresh token; the second one waits and reads the
 * first one's result.
 */
export async function credentials(db: Db, connectionId: string, deps: Deps = {}, force = false): Promise<LiveConnection | null> {
  const env = deps.env ?? process.env, now = deps.now ?? Date.now;
  let rejected: ReauthRequiredError | null = null;
  const live = await db.tx(async (sql): Promise<LiveConnection | null> => {
    const [row] = await sql.query<ConnectionRow>("SELECT * FROM connections WHERE id = $1 FOR UPDATE", [connectionId]);
    if (!row) return null;
    const a = adapter(row.provider);
    const scope = credentialContext(row.user_id, row.provider);
    let current = JSON.parse(open(row.credentials, scope, env)) as Credentials;
    const expiring = current.expiresAt !== undefined && current.expiresAt - now() < REFRESH_MARGIN_MS;
    if (a.refreshCredentials && current.refreshToken && (force || expiring)) {
      try {
        current = await a.refreshCredentials(context(a, deps), current);
        await sql.query("UPDATE connections SET credentials = $2, access_expires_at = $3 WHERE id = $1",
          [row.id, seal(JSON.stringify(current), scope, env), current.expiresAt ? new Date(current.expiresAt).toISOString() : null]);
      } catch (error) {
        if (!(error instanceof ReauthRequiredError)) throw error;
        rejected = error;
        await markReauth(sql, row.id, row.user_id, row.provider, error.message);
        return null;
      }
    } else if (force && !a.refreshCredentials) {
      rejected = new ReauthRequiredError(a.name, `${a.name} needs you to connect again.`);
      await markReauth(sql, row.id, row.user_id, row.provider, rejected.message);
      return null;
    }
    return { id: row.id, userId: row.user_id, provider: row.provider, providerUserId: row.provider_user_id, displayName: row.display_name, scopes: row.scopes, credentials: current };
  });
  if (rejected) throw rejected;
  return live;
}

/** Pauses a connection until the user signs in again: its jobs stop and nothing is retried. */
export async function markReauth(sql: Sql, connectionId: string, userId: string, provider: string, message: string): Promise<void> {
  await sql.query("UPDATE connections SET status = 'reauth_required', last_error = $2 WHERE id = $1", [connectionId, message]);
  await sql.query("UPDATE sync_jobs SET status = 'cancelled', error = $2, lease_until = NULL, finished_at = now() WHERE connection_id = $1 AND status IN ('queued', 'running')", [connectionId, message]);
  await publish(sql, userId, "connection", { provider, change: "reauth_required" });
}
