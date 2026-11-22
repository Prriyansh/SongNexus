import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../db";
import { testDb } from "../../db";
import { encryptionKeys, open, pkceChallenge, redact, seal } from "../crypto";
import { appOrigin, assertSameSite, readCookie, sessionCookie, sessionCookieName } from "../http";
import { AccountError, consents, createSession, endSession, login, rateLimit, register, sessionUser, setConsent, verifyPassword, hashPassword } from "../users";

const key = () => randomBytes(32).toString("base64");

describe("credential encryption", () => {
  const env = { NODE_ENV: "production", INTEGRATIONS_ENCRYPTION_KEY: key() };

  it("round-trips a value and never stores it readable", () => {
    const sealed = seal(JSON.stringify({ accessToken: "secret-token-value" }), "connection:u1:spotify", env);
    expect(sealed).not.toContain("secret-token-value");
    expect(JSON.parse(open(sealed, "connection:u1:spotify", env))).toEqual({ accessToken: "secret-token-value" });
  });

  it("produces a different ciphertext each time", () => {
    expect(seal("same", "ctx", env)).not.toBe(seal("same", "ctx", env));
  });

  it("refuses a value moved to another user's row, a tampered value and the wrong key", () => {
    const sealed = seal("token", "connection:u1:spotify", env);
    expect(() => open(sealed, "connection:u2:spotify", env)).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => open(parts.join("."), "connection:u1:spotify", env)).toThrow();
    expect(() => open(sealed, "connection:u1:spotify", { ...env, INTEGRATIONS_ENCRYPTION_KEY: key() })).toThrow();
  });

  it("still opens values sealed with the previous key after a rotation", () => {
    const sealed = seal("token", "ctx", env);
    const rotated = { NODE_ENV: "production", INTEGRATIONS_ENCRYPTION_KEY: key(), INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS: env.INTEGRATIONS_ENCRYPTION_KEY };
    expect(open(sealed, "ctx", rotated)).toBe("token");
  });

  it("has no key in production unless one is configured, and rejects keys of the wrong size", () => {
    expect(encryptionKeys({ NODE_ENV: "production" })).toEqual([]);
    expect(encryptionKeys({ NODE_ENV: "production", INTEGRATIONS_ENCRYPTION_KEY: "c2hvcnQ=" })).toEqual([]);
    expect(() => seal("x", "ctx", { NODE_ENV: "production" })).toThrow(/isn’t set up/);
  });

  it("derives the PKCE challenge as base64url(SHA-256(verifier)) — RFC 7636 appendix B", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("strips credentials from text before it is logged or stored", () => {
    const text = redact('POST /token?code=abc123&client_secret=shh failed: {"access_token":"ya29.long","refresh_token":"1//x"} Authorization: Bearer abcdefgh12345');
    for (const secret of ["abc123", "shh", "ya29.long", "1//x", "abcdefgh12345"]) expect(text).not.toContain(secret);
    expect(text).toContain("[redacted]");
  });
});

describe("accounts and sessions", () => {
  let db: Db;
  beforeAll(async () => { db = await testDb(); });
  afterAll(async () => { await db.close(); });

  it("hashes passwords with a salt and verifies them", async () => {
    const a = await hashPassword("a long password"), b = await hashPassword("a long password");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("a long password", a)).toBe(true);
    expect(await verifyPassword("a wrong password", a)).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("registers, rejects weak input and duplicate names, and signs in", async () => {
    const user = await register(db, { username: "Ada", password: "correct horse battery" }, "ip1");
    expect(user.username).toBe("Ada");
    await expect(register(db, { username: "ada", password: "another long password" }, "ip1")).rejects.toMatchObject({ status: 409 });
    await expect(register(db, { username: "x", password: "correct horse battery" }, "ip1")).rejects.toBeInstanceOf(AccountError);
    await expect(register(db, { username: "Grace", password: "short" }, "ip1")).rejects.toThrow(/at least 10/);
    expect((await login(db, { username: "ADA", password: "correct horse battery" }, "ip1")).id).toBe(user.id);
    const [row] = await db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [user.id]);
    expect(row.password_hash).not.toContain("correct horse");
  });

  it("gives the same answer for a wrong password and an unknown user, and locks out after repeated failures", async () => {
    const wrong = await login(db, { username: "Ada", password: "nope nope nope" }, "ip2").catch((e: AccountError) => e);
    const unknown = await login(db, { username: "nobody", password: "nope nope nope" }, "ip2").catch((e: AccountError) => e);
    expect((wrong as AccountError).message).toBe((unknown as AccountError).message);
    expect((wrong as AccountError).status).toBe(401);
    let last: AccountError | null = null;
    for (let i = 0; i < 9; i++) last = await login(db, { username: "locked", password: "nope nope nope" }, "ip3").catch((e: AccountError) => e) as AccountError;
    expect(last).toMatchObject({ status: 429 });
    expect(last!.retryAfter).toBeGreaterThan(0);
  });

  it("stores only a hash of the session token, and a session ends on logout or expiry", async () => {
    const user = await register(db, { username: "Linus", password: "correct horse battery" }, "ip4");
    const token = await createSession(db, user.id);
    const rows = await db.query<{ token_hash: string }>("SELECT token_hash FROM sessions WHERE user_id = $1", [user.id]);
    expect(rows[0].token_hash).not.toBe(token);
    expect((await sessionUser(db, token))?.id).toBe(user.id);
    expect(await sessionUser(db, "forged-token")).toBeNull();
    expect(await sessionUser(db, null)).toBeNull();
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [user.id]);
    expect(await sessionUser(db, token)).toBeNull();
    const again = await createSession(db, user.id);
    await endSession(db, again);
    expect(await sessionUser(db, again)).toBeNull();
  });

  it("counts attempts per key and resets when the window passes", async () => {
    await rateLimit(db, "k", 2, 60);
    await rateLimit(db, "k", 2, 60);
    await expect(rateLimit(db, "k", 2, 60)).rejects.toMatchObject({ status: 429 });
    await db.query("UPDATE rate_limits SET reset_at = now() - interval '1 second' WHERE key = 'k'");
    await expect(rateLimit(db, "k", 2, 60)).resolves.toBeUndefined();
  });

  it("records and withdraws consent per user", async () => {
    const user = await register(db, { username: "Consent", password: "correct horse battery" }, "ip5");
    expect(await consents(db, user.id)).toEqual([]);
    await setConsent(db, user.id, "combine_sources", true);
    await setConsent(db, user.id, "combine_sources", true);
    expect(await consents(db, user.id)).toEqual(["combine_sources"]);
    await setConsent(db, user.id, "combine_sources", false);
    expect(await consents(db, user.id)).toEqual([]);
  });
});

describe("request checks", () => {
  const post = (headers: Record<string, string>) => new Request("https://songnexus.example/api/x", { method: "POST", headers });

  it("accepts our own requests and refuses ones without the header, from another origin or marked cross-site", () => {
    expect(() => assertSameSite(post({ "x-requested-with": "SongNexus", origin: "https://songnexus.example" }))).not.toThrow();
    expect(() => assertSameSite(post({ "x-requested-with": "SongNexus" }))).not.toThrow();
    expect(() => assertSameSite(post({ origin: "https://songnexus.example" }))).toThrow();
    expect(() => assertSameSite(post({ "x-requested-with": "SongNexus", origin: "https://evil.example" }))).toThrow();
    expect(() => assertSameSite(post({ "x-requested-with": "SongNexus", "sec-fetch-site": "cross-site" }))).toThrow();
  });

  it("prefers APP_URL for the public origin and otherwise uses the request's", () => {
    const request = new Request("http://127.0.0.1:3000/api/x", { headers: { host: "127.0.0.1:3000" } });
    expect(appOrigin(request, {})).toBe("http://127.0.0.1:3000");
    expect(appOrigin(request, { APP_URL: "https://songnexus.example/" })).toBe("https://songnexus.example");
  });

  it("issues an HttpOnly, SameSite cookie that is Secure and host-bound in production", () => {
    const dev = sessionCookie("abc", { NODE_ENV: "development" });
    expect(dev).toMatch(/^sn_session=abc; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    const production = sessionCookie("abc", { NODE_ENV: "production" });
    expect(production.startsWith("__Host-sn_session=abc;")).toBe(true);
    expect(production).toContain("; Secure");
    expect(sessionCookie(null, {})).toContain("Max-Age=0");
    const request = new Request("http://x/", { headers: { cookie: "other=1; sn_session=tok%2Fen; z=2" } });
    expect(readCookie(request, sessionCookieName({}))).toBe("tok/en");
    expect(readCookie(request, "missing")).toBeNull();
  });
});
