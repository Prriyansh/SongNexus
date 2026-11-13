// Shared by the integration tests: a fresh in-memory Postgres per file, users, and a fake `fetch`
// that answers as a provider would. No test in this repository talks to a real provider; a green
// run here shows our side of each contract, not that a live integration works.

import { randomBytes } from "node:crypto";
import { setDb, testDb } from "../../db";
import type { Db } from "../../db";
import { hashPassword } from "../../accounts/users";
import type { Deps } from "../connections";

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  INTEGRATIONS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  SPOTIFY_CLIENT_ID: "spotify-client",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  LASTFM_API_KEY: "lastfm-key",
  LASTFM_SHARED_SECRET: "lastfm-secret",
  SOUNDCLOUD_CLIENT_ID: "sc-client",
  SOUNDCLOUD_CLIENT_SECRET: "sc-secret",
  TIDAL_CLIENT_ID: "tidal-client",
};

export async function freshDb(): Promise<Db> {
  const db = await testDb();
  setDb(db);
  return db;
}

let counter = 0;
let passwordHash: Promise<string> | null = null;
/** Inserts a user directly (hashing once), so tests don't spend their time in scrypt. */
export async function makeUser(db: Db, name = `user${++counter}`): Promise<string> {
  const hash = await (passwordHash ??= hashPassword("correct horse battery"));
  const [row] = await db.query<{ id: string }>("INSERT INTO users (username, username_key, password_hash) VALUES ($1, $2, $3) RETURNING id", [name, name.toLowerCase(), hash]);
  return row.id;
}

export type Call = { url: URL; method: string; headers: Headers; body: string };
export type Handler = (call: Call) => Response | undefined | Promise<Response | undefined>;

export const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** A fetch that records every call and answers from `handler`; anything unanswered is a 404, which fails loudly. */
export function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = { url: new URL(String(input)), method: init.method ?? "GET", headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : "" };
    calls.push(call);
    return (await handler(call)) ?? reply({ error: `unexpected request: ${call.method} ${call.url}` }, 404);
  }) as typeof fetch;
  return { fetchImpl, calls, paths: () => calls.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`) };
}

export const deps = (fetchImpl: typeof fetch, extra: Partial<Deps> = {}): Deps => ({ env: TEST_ENV, fetchImpl, sleep: async () => {}, ...extra });

/** Stores a connection as if the user had just authorized, without going through OAuth. */
export async function connect(db: Db, userId: string, provider: string, fetchImpl: typeof fetch, input: { token?: string; scopes?: string[]; expiresAt?: number; refreshToken?: string; extra?: Record<string, string>; providerUserId?: string } = {}) {
  const { seal } = await import("../../accounts/crypto");
  const credentials = { accessToken: input.token ?? "access-1", refreshToken: input.refreshToken, expiresAt: input.expiresAt, extra: input.extra };
  const { adapter } = await import("../registry");
  const scopes = input.scopes ?? adapter(provider as never).scopes;
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO connections (user_id, provider, provider_user_id, display_name, scopes, credentials)
     VALUES ($1, $2, $3, 'Test Account', $4::jsonb, $5) RETURNING id`,
    [userId, provider, input.providerUserId ?? "me", JSON.stringify(scopes), seal(JSON.stringify(credentials), `connection:${userId}:${provider}`, TEST_ENV)]);
  void fetchImpl;
  return row.id;
}
