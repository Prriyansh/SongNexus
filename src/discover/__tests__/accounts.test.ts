// Accounts: synced data, accounts as stored, and the routes that sign in, save and delete.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteRoute, GET as accountRoute } from "@/app/api/discover/account/route";
import { PUT as dataRoute } from "@/app/api/discover/account/data/route";
import { DELETE as signOutRoute, POST as signInRoute } from "@/app/api/discover/account/session/route";
import { mergeSynced, sameSynced, syncedFrom, syncedIn, topIn, TOP_KEY, writeSynced } from "../lib/account-data";
import { deleteAccount, MAX_SYNCED, readAccount, saveSynced, signedIn } from "../lib/accounts";
import { forgetKeys, SESSION_COOKIE, sessionValue } from "../lib/auth";
import { GAMES_KEY } from "../lib/game-info";
import { SERVICES_KEY } from "../lib/services";
import { HIDDEN_KEY } from "../lib/stored";
import { memoryStore, store } from "../lib/store";
import { CLIENT_ID, googleToken, keyServer } from "./token";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const artist = (n: number) => ({ id: id(n), name: `Artist ${n}`, note: "", photo: null });
const result = (score: number, submitted = false) => ({ score, gaveUp: false, submitted, answers: [] });
const SECRET = "s".repeat(32);
const ADA = { sub: "1234567890", name: "Ada Lovelace", picture: null, domain: "wisc.edu" };

describe("synced data", () => {
  it("is read from a browser's storage and from JSON with the same checks", () => {
    const stored: Record<string, string> = {
      [GAMES_KEY]: JSON.stringify({ connect: { "20785": result(3) } }),
      [HIDDEN_KEY]: JSON.stringify([artist(1), "bad"]),
      [TOP_KEY]: JSON.stringify([1, 2, 3, 4, 5, 6].map(artist)),
      [SERVICES_KEY]: JSON.stringify([{ service: "listenbrainz", user: "rob" }]),
    };
    const synced = syncedFrom((key) => stored[key] ?? null);
    expect(synced.games.connect["20785"].score).toBe(3);
    expect(synced.hidden).toEqual([artist(1)]);
    expect(synced.top).toHaveLength(5);
    expect(syncedIn(JSON.parse(JSON.stringify(synced)))).toEqual(synced);
    expect(syncedIn(null)).toEqual(syncedIn({}));
    expect(topIn(null)).toEqual([]);
  });

  it("merges every result and hidden artist from both, and this browser's Top 5 when it has one", () => {
    const local = syncedIn({ games: { connect: { "1": result(3), "2": result(4) } }, hidden: [artist(1)], top: [artist(5)], services: [{ service: "deezer", user: "1" }] });
    const saved = syncedIn({ games: { connect: { "2": result(9, true), "3": result(2) } }, hidden: [artist(1), artist(2)], top: [artist(6)], services: [{ service: "deezer", user: "1" }, { service: "deezer", user: "2" }] });
    const merged = mergeSynced(local, saved);
    expect(merged.games.connect).toEqual({ "1": result(3), "2": result(4, true), "3": result(2) });
    expect(merged.hidden.map((a) => a.id)).toEqual([id(1), id(2)]);
    expect(merged.top).toEqual([artist(5)]);
    expect(merged.services).toHaveLength(2);
    expect(mergeSynced(syncedIn({}), saved).top).toEqual([artist(6)]);
    expect(sameSynced(merged, mergeSynced(local, saved))).toBe(true);
    expect(sameSynced(merged, local)).toBe(false);
    const written: Record<string, unknown> = {};
    writeSynced(merged, (key, value) => (written[key] = value));
    expect(Object.keys(written).sort()).toEqual([GAMES_KEY, HIDDEN_KEY, SERVICES_KEY, TOP_KEY].sort());
  });
});

describe("accounts as stored", () => {
  it("start empty, keep data across sign-ins, and go when deleted", async () => {
    const kept = memoryStore();
    expect(await readAccount(kept, ADA.sub)).toBeNull();
    const first = await signedIn(kept, ADA, 5);
    expect([first.created, first.synced.top]).toEqual([5, []]);
    await saveSynced(kept, ADA, syncedIn({ top: [artist(1)] }));
    const again = await signedIn(kept, { ...ADA, name: "Ada" }, 99);
    expect([again.created, again.person.name, again.synced.top]).toEqual([5, "Ada", [artist(1)]]);
    await deleteAccount(kept, ADA.sub);
    expect(await readAccount(kept, ADA.sub)).toBeNull();
    await saveSynced(kept, ADA, syncedIn({}));
    expect((await readAccount(kept, ADA.sub))!.person).toEqual(ADA);
  });
});

describe("the account routes", () => {
  const ORIGIN = "http://song.nexus";
  const cookie = `${SESSION_COOKIE}=${sessionValue(ADA, SECRET)}`;
  const call = async (
    route: (r: Request) => Promise<Response>,
    { method = "GET", body, signedIn: withCookie = false, origin = ORIGIN }: { method?: string; body?: string; signedIn?: boolean; origin?: string | null } = {},
  ) => {
    const headers: Record<string, string> = {};
    if (origin) headers.origin = origin;
    if (withCookie) headers.cookie = cookie;
    const response = await route(new Request(`${ORIGIN}/api/discover/account`, { method, body, headers }));
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie") };
  };

  beforeEach(() => {
    forgetKeys();
    vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubGlobal("fetch", vi.fn(keyServer()));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await store()!.del(`account:${ADA.sub}`);
  });

  it("say when sign-in isn't set up, or storage isn't", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect((await call(accountRoute)).body).toEqual({ enabled: false, person: null, synced: null });
    expect((await call(signInRoute, { method: "POST", body: "{}" })).status).toBe(503);
    vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    expect((await call(accountRoute)).status).toBe(503);
  });

  it("sign in with a Google token, set the session, and answer who is signed in", async () => {
    expect((await call(accountRoute)).body).toEqual({ enabled: true, person: null, synced: null });
    const signed = await call(signInRoute, { method: "POST", body: JSON.stringify({ credential: googleToken({ hd: "wisc.edu" }) }) });
    expect(signed.status).toBe(200);
    expect(signed.body.person).toEqual({ name: "Ada Lovelace", picture: "https://lh3.googleusercontent.com/a/photo", domain: "wisc.edu" });
    expect(signed.cookie).toContain(`${SESSION_COOKIE}=`);
    expect(signed.cookie).toContain("HttpOnly");
    const me = await call(accountRoute, { signedIn: true });
    expect(me.body.person.name).toBe("Ada Lovelace");
    expect(me.body.synced.top).toEqual([]);
    await store()!.del(`account:${ADA.sub}`);
    expect((await call(accountRoute, { signedIn: true })).body.synced).toBeNull();
  });

  it("refuse sign-ins Google didn't confirm, odd bodies, other sites, and Google being away", async () => {
    expect((await call(signInRoute, { method: "POST", body: JSON.stringify({ credential: googleToken({ aud: "x" }) }) })).status).toBe(401);
    expect((await call(signInRoute, { method: "POST", body: JSON.stringify({ credential: 5 }) })).status).toBe(400);
    expect((await call(signInRoute, { method: "POST", body: JSON.stringify({ credential: "x".repeat(5000) }) })).status).toBe(400);
    expect((await call(signInRoute, { method: "POST", body: "{}", origin: "https://evil.example" })).status).toBe(403);
    expect((await call(signInRoute, { method: "POST", body: "{}", origin: null })).status).toBe(403);
    forgetKeys();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect((await call(signInRoute, { method: "POST", body: JSON.stringify({ credential: googleToken() }) })).status).toBe(502);
  });

  it("sign out", async () => {
    const out = await call(signOutRoute, { method: "DELETE", signedIn: true });
    expect([out.status, out.cookie]).toEqual([200, expect.stringContaining("Max-Age=0")]);
    expect((await call(signOutRoute, { method: "DELETE", origin: "https://evil.example" })).status).toBe(403);
  });

  it("save synced data for whoever is signed in, checked and within a size", async () => {
    const synced = { top: [artist(1)], hidden: [], games: {}, services: [], extra: "dropped" };
    const saved = await call(dataRoute, { method: "PUT", body: JSON.stringify(synced), signedIn: true });
    expect(saved.status).toBe(200);
    expect(saved.body.synced.top).toEqual([artist(1)]);
    expect(saved.body.synced.extra).toBeUndefined();
    expect((await readAccount(store()!, ADA.sub))!.synced.top).toEqual([artist(1)]);
    expect((await call(dataRoute, { method: "PUT", body: "{}" })).status).toBe(401);
    expect((await call(dataRoute, { method: "PUT", body: "{oops", signedIn: true })).status).toBe(400);
    expect((await call(dataRoute, { method: "PUT", body: "x".repeat(MAX_SYNCED + 1), signedIn: true })).status).toBe(413);
    expect((await call(dataRoute, { method: "PUT", body: "{}", signedIn: true, origin: "https://evil.example" })).status).toBe(403);
  });

  it("delete an account and everything synced to it", async () => {
    await signedIn(store()!, ADA);
    const gone = await call(deleteRoute, { method: "DELETE", signedIn: true });
    expect([gone.status, gone.body, gone.cookie]).toEqual([200, { deleted: true }, expect.stringContaining("Max-Age=0")]);
    expect(await readAccount(store()!, ADA.sub)).toBeNull();
    expect((await call(deleteRoute, { method: "DELETE" })).status).toBe(401);
    expect((await call(deleteRoute, { method: "DELETE", origin: null })).status).toBe(403);
  });
});
