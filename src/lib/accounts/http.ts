// What every account and integration route shares: the session cookie, the cross-site request
// check, the signed-in user, and one mapping from errors to JSON responses. Handlers stay thin and
// can be called directly with a Request in tests.

import { NextResponse } from "next/server";
import { DatabaseUnavailableError, getDb } from "../db";
import type { Db } from "../db";
import { ValidationError } from "../musicbrainz";
import { EncryptionUnavailableError, redact } from "./crypto";
import { AccountError, SESSION_DAYS, sessionUser } from "./users";
import type { User } from "./users";

type Env = Record<string, string | undefined>;

/** An error whose message is safe to show, with the HTTP status to send. */
export class ApiProblem extends Error {
  constructor(message: string, readonly status = 400, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiProblem";
  }
}

// "__Host-" makes browsers refuse the cookie unless it's Secure, host-only and Path=/.
export const sessionCookieName = (env: Env = process.env) => (env.NODE_ENV === "production" ? "__Host-sn_session" : "sn_session");

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) {
      try { return decodeURIComponent(part.slice(at + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export function sessionCookie(token: string | null, env: Env = process.env): string {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  const life = token ? SESSION_DAYS * 24 * 60 * 60 : 0;
  return `${sessionCookieName(env)}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${life}${secure}`;
}

/**
 * The public origin of this deployment, used for OAuth redirect URIs and the same-origin check.
 * APP_URL wins; on Vercel the production domain is known; otherwise it's the request's own origin.
 */
export function appOrigin(request: Request, env: Env = process.env): string {
  const configured = env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "SongNexus";

/**
 * Requests that change something must come from our own pages. A custom header can't be added by a
 * cross-site form, and a cross-site fetch that adds one needs a CORS preflight we never approve; the
 * Origin and Sec-Fetch-Site checks back that up, as does the SameSite=Lax cookie.
 */
export function assertSameSite(request: Request, env: Env = process.env): void {
  if (request.headers.get(CSRF_HEADER) !== CSRF_VALUE) throw new ApiProblem("This request didn’t come from Song Nexus.", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new ApiProblem("This request didn’t come from Song Nexus.", 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== appOrigin(request, env) && origin !== new URL(request.url).origin) throw new ApiProblem("This request didn’t come from Song Nexus.", 403);
}

/** For rate limits: the first forwarded address, which the hosting platform sets. */
export const clientKey = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";

export const NO_STORE = { "Cache-Control": "no-store" };
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });

export function problemResponse(error: unknown, scope: string): Response {
  if (error instanceof ApiProblem) return json({ error: error.message, ...error.extra }, error.status);
  if (error instanceof AccountError) return json({ error: error.message }, error.status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {});
  if (error instanceof ValidationError) return json({ error: error.message }, 400);
  if (error instanceof DatabaseUnavailableError || error instanceof EncryptionUnavailableError) return json({ error: error.message, unavailable: true }, 503);
  console.error(`[${scope}]`, redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error)));
  return json({ error: "Something went wrong on our side. Please try again.", retryable: true }, 500);
}

export type RouteContext<P> = { request: Request; url: URL; db: Db; user: User; params: P; env: Env };
type Options = { /** Signed-out requests get 401 unless this is false. */ auth?: boolean; scope?: string };
type NextContext<P> = { params: Promise<P> };

/**
 * Wraps a handler: opens the database, checks the request came from our pages (for anything but GET),
 * resolves the signed-in user and turns thrown errors into JSON. With `auth: false` the user may be
 * null, so those handlers get `user` typed as possibly null.
 */
export function route<P = Record<string, never>>(handler: (ctx: RouteContext<P>) => Promise<Response>, options?: Options & { auth?: true }): (request: Request, context?: NextContext<P>) => Promise<Response>;
export function route<P = Record<string, never>>(handler: (ctx: Omit<RouteContext<P>, "user"> & { user: User | null }) => Promise<Response>, options: Options & { auth: false }): (request: Request, context?: NextContext<P>) => Promise<Response>;
export function route<P>(handler: (ctx: RouteContext<P>) => Promise<Response>, options: Options = {}) {
  return async (request: Request, context?: NextContext<P>): Promise<Response> => {
    const scope = options.scope ?? new URL(request.url).pathname;
    try {
      const env = process.env;
      if (request.method !== "GET" && request.method !== "HEAD") assertSameSite(request, env);
      const db = await getDb(env);
      const user = await sessionUser(db, readCookie(request, sessionCookieName(env)));
      if (!user && options.auth !== false) throw new ApiProblem("Sign in to Song Nexus first.", 401, { signedOut: true });
      const params = (context ? await context.params : {}) as P;
      return await handler({ request, url: new URL(request.url), db, user: user as User, params, env });
    } catch (error) {
      return problemResponse(error, scope);
    }
  };
}

const MAX_BODY = 3_500_000; // Under Vercel's 4.5 MB request limit, with room for headers.

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new ApiProblem("That request is too large.", 413);
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    if (reader) for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY) {
        await reader.cancel();
        throw new ApiProblem("That request is too large.", 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader?.releaseLock(); }
  try {
    const value: unknown = JSON.parse(text || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Falls through. */ }
  throw new ApiProblem("Send a JSON object.", 400);
}
