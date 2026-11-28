// Signing in with Google and the session cookie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authConfig,
  cookieOf,
  forgetKeys,
  personOf,
  readSession,
  sameOrigin,
  SESSION_COOKIE,
  sessionCookie,
  sessionValue,
  verifyGoogle,
} from "../lib/auth";
import { CLIENT_ID, googleToken, keyServer } from "./token";

const SECRET = "s".repeat(32);
const ADA = { sub: "1234567890", name: "Ada Lovelace", picture: "https://lh3.googleusercontent.com/a/photo", domain: null };
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

beforeEach(() => forgetKeys());

describe("settings", () => {
  it("need a client ID and a long enough secret", () => {
    expect(authConfig({ GOOGLE_CLIENT_ID: " id ", SESSION_SECRET: SECRET })).toEqual({ clientId: "id", secret: SECRET });
    expect(authConfig({ GOOGLE_CLIENT_ID: "id", SESSION_SECRET: "short" })).toBeNull();
    expect(authConfig({ SESSION_SECRET: SECRET })).toBeNull();
    expect(authConfig({ GOOGLE_CLIENT_ID: "id" })).toBeNull();
  });
});

describe("Google's ID tokens", () => {
  it("names the person Google signed for this app", async () => {
    expect(await verifyGoogle(googleToken(), CLIENT_ID, keyServer())).toEqual(ADA);
    const work = await verifyGoogle(googleToken({ hd: "Wisc.EDU", name: "  ", picture: "http://x" }), CLIENT_ID, keyServer());
    expect(work).toEqual({ sub: ADA.sub, name: "You", picture: null, domain: "wisc.edu" });
    expect((await verifyGoogle(googleToken({ hd: "bad domain!", iss: "accounts.google.com" }), CLIENT_ID, keyServer()))!.domain).toBeNull();
  });

  it("refuses tokens for another app, expired, from elsewhere, or for odd people", async () => {
    for (const claims of [{ aud: "other" }, { exp: 1 }, { exp: "soon" }, { iss: "https://evil.example" }, { sub: "not-a-number" }, { sub: 42 }])
      expect(await verifyGoogle(googleToken(claims), CLIENT_ID, keyServer()), JSON.stringify(claims)).toBeNull();
  });

  it("refuses tokens that aren't signed right", async () => {
    const good = googleToken();
    const [head, body] = good.split(".");
    const tampered = `${head}.${part({ ...JSON.parse(Buffer.from(body, "base64url").toString()), sub: "999" })}.${good.split(".")[2]}`;
    for (const token of [tampered, "a.b", "%%%.%%%.%%%", googleToken({}, { alg: "HS256" }), googleToken({}, { kid: undefined }), googleToken({}, { kid: "other" })])
      expect(await verifyGoogle(token, CLIENT_ID, keyServer())).toBeNull();
  });

  it("keeps Google's keys as long as Google says, and fails when they can't be read", async () => {
    const fetchImpl = vi.fn(keyServer("public, max-age=100"));
    await verifyGoogle(googleToken(), CLIENT_ID, fetchImpl, 1_000_000);
    await verifyGoogle(googleToken(), CLIENT_ID, fetchImpl, 1_050_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await verifyGoogle(googleToken({ exp: 2e9 }), CLIENT_ID, fetchImpl, 1_200_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    forgetKeys();
    await expect(verifyGoogle(googleToken(), CLIENT_ID, async () => new Response("", { status: 500 }))).rejects.toThrow("(500)");
  });
});

describe("sessions", () => {
  it("are signed and end after a month", () => {
    const value = sessionValue(ADA, SECRET, 0);
    expect(readSession(value, SECRET, 1000)).toEqual(ADA);
    expect(readSession(value, SECRET, 31 * 86_400_000)).toBeNull();
    expect(readSession(value, "x".repeat(32), 1000)).toBeNull();
    const [data, signature] = value.split(".");
    for (const bad of [null, undefined, "", data, `${data}.${signature}.x`, `${data}.short`, `${part({ ...ADA, exp: 9e15 })}.${signature}`])
      expect(readSession(bad, SECRET, 1000)).toBeNull();
  });

  it("travel in an HTTP-only cookie, secure in production", () => {
    expect(sessionCookie("v", {})).toBe(`${SESSION_COOKIE}=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    expect(sessionCookie(null, { NODE_ENV: "production" })).toBe(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`);
  });

  it("are read from a request's cookies", () => {
    const value = sessionValue(ADA, SECRET);
    const request = new Request("http://x/", { headers: { cookie: `other=1; ${SESSION_COOKIE}=${value}` } });
    expect(cookieOf(request, SESSION_COOKIE)).toBe(value);
    expect(cookieOf(new Request("http://x/"), SESSION_COOKIE)).toBeNull();
    expect(personOf(request, { GOOGLE_CLIENT_ID: "id", SESSION_SECRET: SECRET })).toEqual(ADA);
    expect(personOf(request, {})).toBeNull();
  });

  it("accept changes only from this site's own pages", () => {
    expect(sameOrigin(new Request("http://song.nexus/api", { headers: { origin: "http://song.nexus" } }))).toBe(true);
    expect(sameOrigin(new Request("http://song.nexus/api", { headers: { origin: "https://evil.example" } }))).toBe(false);
    expect(sameOrigin(new Request("http://song.nexus/api"))).toBe(false);
  });
});
