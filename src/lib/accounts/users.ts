// SongNexus accounts: a username and a password, independent of any music service. Passwords are
// hashed with scrypt; sessions are random tokens in an HttpOnly cookie, stored hashed.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { Db, Sql } from "../db";
import { iso } from "../db";
import { randomToken, sha256 } from "./crypto";
import { deleteOrphans } from "../integrations/store";

export type User = { id: string; username: string; createdAt: string };

export class AccountError extends Error {
  constructor(message: string, readonly status = 400, readonly retryAfter?: number) {
    super(message);
    this.name = "AccountError";
  }
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_DAYS = 30;
const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
export const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;

const scrypt = (password: string, salt: Buffer, N = SCRYPT.N, r = SCRYPT.r, p = SCRYPT.p, keylen = SCRYPT.keylen) =>
  new Promise<Buffer>((resolve, reject) => scryptCallback(password.normalize("NFKC"), salt, keylen, { N, r, p }, (error, key) => error ? reject(error) : resolve(key)));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), Number(N), Number(r), Number(p), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Checked when the username doesn't exist, so a wrong username takes as long as a wrong password.
let decoy: Promise<string> | null = null;

const toUser = (row: { id: string; username: string; created_at: unknown }): User => ({ id: row.id, username: row.username, createdAt: iso(row.created_at)! });

export function validateCredentials(input: unknown): { username: string; password: string } {
  const body = (input && typeof input === "object" ? input : {}) as { username?: unknown; password?: unknown };
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!USERNAME.test(username)) throw new AccountError("Usernames are 3–32 letters, numbers, dots, dashes or underscores.");
  if (password.length < PASSWORD_MIN) throw new AccountError(`Passwords need at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) throw new AccountError(`Passwords can be at most ${PASSWORD_MAX} characters.`);
  return { username, password };
}

/**
 * Counts an attempt against `key` and throws 429 once `limit` is passed within the window. One
 * statement, so concurrent requests can't slip past each other.
 */
export async function rateLimit(sql: Sql, key: string, limit: number, windowSeconds: number): Promise<void> {
  const [row] = await sql.query<{ count: number; reset_at: unknown }>(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= now() THEN now() + make_interval(secs => $2) ELSE rate_limits.reset_at END
     RETURNING count, reset_at`, [key, windowSeconds]);
  if (row.count > limit) {
    const wait = Math.max(1, Math.ceil((new Date(iso(row.reset_at)!).getTime() - Date.now()) / 1000));
    throw new AccountError("Too many attempts. Please wait a little and try again.", 429, wait);
  }
}

export async function register(db: Db, input: unknown, clientKey: string): Promise<User> {
  const { username, password } = validateCredentials(input);
  await rateLimit(db, `register:${clientKey}`, 10, 3600);
  const hash = await hashPassword(password);
  const rows = await db.query<{ id: string; username: string; created_at: unknown }>(
    `INSERT INTO users (username, username_key, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (username_key) DO NOTHING RETURNING id, username, created_at`, [username, username.toLowerCase(), hash]);
  if (!rows.length) throw new AccountError("That username is taken.", 409);
  return toUser(rows[0]);
}

export async function login(db: Db, input: unknown, clientKey: string): Promise<User> {
  const body = (input && typeof input === "object" ? input : {}) as { username?: unknown; password?: unknown };
  const username = typeof body.username === "string" ? body.username.trim().slice(0, 64) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, PASSWORD_MAX) : "";
  await rateLimit(db, `login:${username.toLowerCase()}`, 8, 900);
  await rateLimit(db, `login-ip:${clientKey}`, 40, 900);
  const [row] = await db.query<{ id: string; username: string; created_at: unknown; password_hash: string }>(
    "SELECT id, username, created_at, password_hash FROM users WHERE username_key = $1", [username.toLowerCase()]);
  const ok = await verifyPassword(password, row?.password_hash ?? await (decoy ??= hashPassword(randomToken())));
  if (!row || !ok) throw new AccountError("That username and password don’t match.", 401);
  return toUser(row);
}

/** Starts a session and returns the token for the cookie. Only its hash is stored. */
export async function createSession(sql: Sql, userId: string): Promise<string> {
  const token = randomToken();
  await sql.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))", [userId, sha256(token), SESSION_DAYS]);
  return token;
}

export async function sessionUser(sql: Sql, token: string | null): Promise<User | null> {
  if (!token || token.length > 200) return null;
  const [row] = await sql.query<{ id: string; username: string; created_at: unknown }>(
    `UPDATE sessions s SET last_seen_at = now() FROM users u
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = s.user_id
     RETURNING u.id, u.username, u.created_at`, [sha256(token)]);
  return row ? toUser(row) : null;
}

export async function endSession(sql: Sql, token: string | null): Promise<void> {
  if (token) await sql.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

/** Deletes the account and, through cascades, every connection, credential, synced row and import. */
export async function deleteUser(db: Db, userId: string): Promise<void> {
  await db.tx(async sql => {
    const sources = await sql.query<{ source: string }>(
      "SELECT provider AS source FROM connections WHERE user_id = $1 UNION SELECT 'import:' || format || ':' || user_id::text FROM imports WHERE user_id = $1", [userId]);
    await sql.query("DELETE FROM users WHERE id = $1", [userId]);
    for (const { source } of sources) await deleteOrphans(sql, source);
  });
}

/** For actions that need the password again, such as deleting the account. Throws 403 if it's wrong. */
export async function verifyUserPassword(db: Db, userId: string, password: string): Promise<void> {
  await rateLimit(db, `password:${userId}`, 8, 900);
  const [row] = await db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [userId]);
  if (!row || !(await verifyPassword(password.slice(0, PASSWORD_MAX), row.password_hash))) throw new AccountError("That password doesn’t match.", 403);
}

export const CONSENTS = ["combine_sources"] as const;
export type Consent = typeof CONSENTS[number];

export async function consents(sql: Sql, userId: string): Promise<Consent[]> {
  const rows = await sql.query<{ kind: string }>("SELECT kind FROM user_consents WHERE user_id = $1", [userId]);
  return rows.map((r) => r.kind).filter((k): k is Consent => (CONSENTS as readonly string[]).includes(k));
}

export async function setConsent(sql: Sql, userId: string, kind: Consent, granted: boolean): Promise<void> {
  if (granted) await sql.query("INSERT INTO user_consents (user_id, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, kind]);
  else await sql.query("DELETE FROM user_consents WHERE user_id = $1 AND kind = $2", [userId, kind]);
}

/** Housekeeping the sync worker runs now and then. */
export async function pruneExpired(sql: Sql): Promise<void> {
  await sql.query("DELETE FROM sessions WHERE expires_at <= now()");
  await sql.query("DELETE FROM rate_limits WHERE reset_at <= now()");
  await sql.query("DELETE FROM oauth_states WHERE expires_at <= now()");
  await sql.query("DELETE FROM user_events WHERE created_at < now() - interval '1 day'");
  await sql.query("DELETE FROM sync_jobs WHERE status IN ('succeeded', 'failed', 'cancelled') AND finished_at < now() - interval '14 days'");
  await sql.query("DELETE FROM imports WHERE status = 'staging' AND created_at < now() - interval '1 day'");
}
