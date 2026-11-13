// Requests to music services: a timeout, a couple of retries with backoff for network errors and
// 5xx, and typed errors the sync engine acts on (wait, ask the user to reconnect, or give up).
// Error text is redacted before it can reach a log or the database.

import { redact } from "../accounts/crypto";
import type { HttpReply } from "./types";

const TIMEOUT_MS = 15_000;
const MAX_INLINE_WAIT_MS = 3_000;
const DEFAULT_RATE_WAIT_MS = 60_000;
export const USER_AGENT = "SongNexus/1.0.0 (https://github.com/Prriyansh/SongNexus)";

export class ProviderError extends Error {
  constructor(readonly provider: string, message: string, readonly status = 502, readonly retryable = false) {
    super(message);
    this.name = "ProviderError";
  }
}
/** 429, or a quota error: try again no sooner than retryAfterMs. */
export class RateLimitedError extends ProviderError {
  constructor(provider: string, readonly retryAfterMs: number) {
    super(provider, `${provider} asked us to slow down.`, 429, true);
    this.name = "RateLimitedError";
  }
}
/** 401: the token is expired, revoked or wrong. */
export class ReauthRequiredError extends ProviderError {
  constructor(provider: string, message = `${provider} no longer accepts this authorization.`) {
    super(provider, message, 401, false);
    this.name = "ReauthRequiredError";
  }
}
/** 403: signed in, but not allowed to read this (missing scope, account tier, app restrictions). */
export class AccessDeniedError extends ProviderError {
  constructor(provider: string, message: string) {
    super(provider, message, 403, false);
    this.name = "AccessDeniedError";
  }
}

export type HttpOptions = {
  fetchImpl?: typeof fetch;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Statuses returned to the caller, with any JSON body, instead of thrown (a 404 that means "nothing here"). */
  allowStatus?: number[];
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry-After (seconds or a date), or ListenBrainz's X-RateLimit-Reset-In. Null if the reply doesn't say. */
export function retryAfterMs(headers: Headers, now = Date.now()): number | null {
  const value = headers.get("retry-after") ?? headers.get("x-ratelimit-reset-in");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

const detail = async (response: Response) => {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: unknown; error_description?: unknown; message?: unknown; errors?: { detail?: unknown; title?: unknown }[] };
    const nested = body.error && typeof body.error === "object" ? (body.error as { message?: unknown }).message : body.error;
    const first = body.errors?.[0];
    const message = [body.error_description, nested, body.message, first?.detail, first?.title].find((m) => typeof m === "string" && m);
    if (typeof message === "string") return redact(message).slice(0, 200);
  } catch { /* Not JSON. */ }
  return "";
};

export async function providerJson<T>(provider: string, url: string, init: RequestInit = {}, options: HttpOptions = {}): Promise<HttpReply<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? wait;
  const retries = options.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    const backoff = 500 * 2 ** attempt + Math.random() * 250;
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      if (attempt < retries) { await sleep(backoff); continue; }
      throw new ProviderError(provider, `Could not reach ${provider}.`, 502, true);
    }
    if (response.status === 429) {
      const ms = retryAfterMs(response.headers);
      if (ms !== null && ms <= MAX_INLINE_WAIT_MS && attempt < retries) { await sleep(ms + 100); continue; }
      throw new RateLimitedError(provider, ms ?? DEFAULT_RATE_WAIT_MS);
    }
    if (response.status >= 500) {
      if (attempt < retries) { await sleep(backoff); continue; }
      throw new ProviderError(provider, `${provider} is having trouble (${response.status}).`, 502, true);
    }
    if (options.allowStatus?.includes(response.status) && response.status < 500 && response.status !== 429) {
      const body = await response.text().catch(() => "");
      let data: T | null = null;
      // The caller reads this error itself (Last.fm puts its error code in the body).
      try { data = JSON.parse(body) as T; } catch { /* No JSON body. */ }
      return { status: response.status, data, headers: response.headers };
    }
    if (response.status === 401) throw new ReauthRequiredError(provider);
    if (response.status === 403) {
      const why = await detail(response);
      // Google reports an exhausted daily quota as 403, not 429.
      if (/quota|rate ?limit/i.test(why)) throw new RateLimitedError(provider, 60 * 60_000);
      throw new AccessDeniedError(provider, why ? `${provider} refused access: ${why}` : `${provider} refused access to this.`);
    }
    if (response.status === 204) return { status: 204, data: null, headers: response.headers };
    if (!response.ok) {
      const why = await detail(response);
      throw new ProviderError(provider, `${provider} returned an error (${response.status})${why ? `: ${why}` : "."}`, 502, false);
    }
    const text = await response.text();
    if (!text) return { status: response.status, data: null, headers: response.headers };
    try {
      return { status: response.status, data: JSON.parse(text) as T, headers: response.headers };
    } catch {
      throw new ProviderError(provider, `${provider} returned a malformed response.`, 502, false);
    }
  }
}

export const form = (fields: Record<string, string | undefined>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString(),
});

type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };

/** The standard OAuth token response as Credentials. Keeps the old refresh token when none is returned. */
export function tokenCredentials(provider: string, reply: TokenReply | null, previous?: { refreshToken?: string }, now = Date.now()) {
  if (!reply?.access_token) throw new ProviderError(provider, `${provider} didn’t return an access token.`);
  return {
    credentials: {
      accessToken: reply.access_token,
      refreshToken: reply.refresh_token ?? previous?.refreshToken,
      ...(typeof reply.expires_in === "number" ? { expiresAt: now + reply.expires_in * 1000 } : {}),
    },
    scopes: typeof reply.scope === "string" ? reply.scope.split(/[\s,]+/).filter(Boolean) : null,
  };
}

/** A refresh the provider rejected (revoked, expired, already used) means the user must reconnect. */
export async function refreshWith<T>(provider: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProviderError && !error.retryable && !(error instanceof RateLimitedError)) throw new ReauthRequiredError(provider, `${provider} needs you to sign in again.`);
    throw error;
  }
}
