// Signing in with Google, and the session that follows. Google's button hands the browser an ID token
// (a JWT signed by Google); the server checks it against Google's published keys, then keeps its own
// session in a signed, HTTP-only cookie. Needs GOOGLE_CLIENT_ID and SESSION_SECRET. Server only.
import { createHmac, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";

export const SESSION_COOKIE = "sn_session";
export const SESSION_DAYS = 30;
const GOOGLE_KEYS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export type Env = Record<string, string | undefined>;

/** Who signed in: Google's ID for them, and what they let it show. `domain` is a workplace's or school's. */
export type Person = { sub: string; name: string; picture: string | null; domain: string | null };

/** The settings sign-in needs, or null while either is missing (or the secret too short to trust). */
export function authConfig(env: Env = process.env): { clientId: string; secret: string } | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const secret = env.SESSION_SECRET?.trim();
  return clientId && secret && secret.length >= 32 ? { clientId, secret } : null;
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");
const fromBase64url = (text: string) => Buffer.from(text, "base64url");

let keys: { expires: number; byId: Map<string, JsonWebKey> } | null = null;

/** Google's signing keys, kept as long as Google says they stay good. */
async function googleKeys(fetchImpl: typeof fetch, now: number): Promise<Map<string, JsonWebKey>> {
  if (keys && keys.expires > now) return keys.byId;
  const response = await fetchImpl(GOOGLE_KEYS, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Google's keys didn't load (${response.status}).`);
  const { keys: list } = (await response.json()) as { keys: (JsonWebKey & { kid: string })[] };
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  keys = { expires: now + maxAge * 1000, byId: new Map(list.map((key) => [key.kid, key])) };
  return keys.byId;
}

/** Forgets Google's keys, so the next check fetches them again. For tests. */
export const forgetKeys = () => void (keys = null);

/** The person a Google ID token names, if Google signed it for this app and it hasn't expired. */
export async function verifyGoogle(
  token: string,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<Person | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(fromBase64url(parts[0]).toString("utf8"));
    claims = JSON.parse(fromBase64url(parts[1]).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  const jwk = (await googleKeys(fetchImpl, now)).get(header.kid);
  if (!jwk) return null;
  const signed = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), fromBase64url(parts[2]));
  if (!signed) return null;
  const { iss, aud, exp, sub, name, picture, hd } = claims;
  if (!ISSUERS.has(String(iss)) || aud !== clientId || typeof exp !== "number" || exp * 1000 <= now) return null;
  if (typeof sub !== "string" || !/^\d{1,40}$/.test(sub)) return null;
  return {
    sub,
    name: typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : "You",
    picture: typeof picture === "string" && picture.startsWith("https://") ? picture : null,
    domain: typeof hd === "string" && /^[a-z0-9.-]{3,100}$/i.test(hd) ? hd.toLowerCase() : null,
  };
}

const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

/** A session cookie's value: the person and when it ends, signed with the server's secret. */
export function sessionValue(person: Person, secret: string, now = Date.now()): string {
  const data = base64url(JSON.stringify({ ...person, exp: now + SESSION_DAYS * 86_400_000 }));
  return `${data}.${sign(data, secret)}`;
}

/** The person a session cookie's value names, if the server signed it and it hasn't ended. */
export function readSession(value: string | null | undefined, secret: string, now = Date.now()): Person | null {
  const [data, signature, extra] = (value ?? "").split(".");
  if (!data || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const { exp, sub, name, picture, domain } = JSON.parse(fromBase64url(data).toString("utf8")) as Person & { exp: number };
  return exp > now ? { sub, name, picture, domain } : null;
}

/** A cookie's value from a request. */
export function cookieOf(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Who a request comes from, if they're signed in. */
export function personOf(request: Request, env: Env = process.env): Person | null {
  const config = authConfig(env);
  return config && readSession(cookieOf(request, SESSION_COOKIE), config.secret);
}

/** The Set-Cookie header that starts a session, or (with null) ends it. */
export function sessionCookie(value: string | null, env: Env = process.env): string {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  const life = value ? `Max-Age=${SESSION_DAYS * 86_400}` : "Max-Age=0";
  return `${SESSION_COOKIE}=${value ?? ""}; Path=/; HttpOnly; SameSite=Lax; ${life}${secure}`;
}

/**
 * Whether a request that changes something comes from this site's own pages. With SameSite=Lax
 * cookies this is a second guard against other sites acting for a signed-in person.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}
