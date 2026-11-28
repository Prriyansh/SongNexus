// Around You: communities, charts that open only with enough members, the weekly recap, and the route.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteAccountRoute } from "@/app/api/discover/account/route";
import { DELETE as leaveRoute, GET as communitiesRoute, POST as joinRoute } from "@/app/api/discover/communities/route";
import { SESSION_COOKIE, sessionValue } from "../lib/auth";
import { communityOf, join, leave, leaveAll, memberships, MIN_MEMBERS, recapOf, viewOf } from "../lib/communities";
import { dayNumber } from "../lib/days";
import { memoryStore, redisStore, store } from "../lib/store";
import { world } from "./world";

const g = world({ artists: ["A", "B", "C", "D"], others: ["Quiet", "Quiet2"], listeners: { B: 50_000, C: 50_000 } });
const [A, B, C, D, QUIET, QUIET2] = g.catalog.artists.map((a) => a.id);
const DAY = 20_800;
const US = communityOf("country:US")!;

describe("communities", () => {
  it("are a campus domain or a country", () => {
    expect(communityOf("campus:wisc.edu")).toEqual({ id: "campus:wisc.edu", kind: "campus", name: "wisc.edu" });
    expect(communityOf("country:SE")).toEqual({ id: "country:SE", kind: "country", name: "Sweden" });
    for (const bad of ["campus:localhost", `campus:${"a".repeat(100)}.edu`, "country:us", "country:XW", "country:QQ", "city:Paris", ""])
      expect(communityOf(bad), bad).toBeNull();
  });

  it("are joined, renewed, left, and all left at once", async () => {
    const kept = memoryStore();
    await join(kept, US.id, "p1", [A]);
    await join(kept, US.id, "p1", [B]);
    await join(kept, "campus:wisc.edu", "p1", [A]);
    expect(await memberships(kept, "p1")).toEqual([US.id, "campus:wisc.edu"]);
    await leave(kept, US.id, "p1");
    expect(await memberships(kept, "p1")).toEqual(["campus:wisc.edu"]);
    await leaveAll(kept, "p1");
    expect(await memberships(kept, "p1")).toEqual([]);
    expect((await viewOf(g, kept, US, DAY, "p1")).members).toBe(0);
    await kept.unrank("nothing", "p1");
  });

  it("drop a member from Redis's ranked list", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: 1 })));
    await redisStore("https://redis", "t", fetchImpl as typeof fetch).unrank("k", "m");
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual(["ZREM", "k", "m"]);
  });
});

describe("a chart", () => {
  const filled = async (count: number, artists: (i: number) => string[]) => {
    const kept = memoryStore();
    for (let i = 0; i < count; i++) await join(kept, US.id, `p${i}`, artists(i));
    return kept;
  };

  it("stays locked until enough members share, counting only those who shared an artist in the catalog", async () => {
    const kept = await filled(MIN_MEMBERS - 1, () => [A]);
    await join(kept, US.id, "nobody", ["not-in-catalog"]);
    // A member whose shared artists have expired.
    await kept.rankNew(`community:${US.id}:members`, "expired", 1, 99);
    const view = await viewOf(g, kept, US, DAY, "p0");
    expect(view).toMatchObject({ members: MIN_MEMBERS + 1, sharing: MIN_MEMBERS - 1, needed: 1, chart: [], recap: null, joined: true });
    expect((await viewOf(g, kept, US, DAY, null)).joined).toBe(false);
    expect((await viewOf(g, kept, US, DAY, "stranger")).joined).toBe(false);
  });

  it("lists artists several members named, most first, then the most listened to", async () => {
    // Everyone names A; the others two each, ties broken by listeners (the Quiets have none), then
    // catalog order. Only one member names "x", which isn't in the catalog anyway.
    const names = [[A, A, B, C], [A, B, C], [A, D, QUIET, QUIET2], [A, D, QUIET, QUIET2], [A]];
    const kept = await filled(MIN_MEMBERS, (i) => names[i]);
    await join(kept, US.id, "one", ["x"]);
    const view = await viewOf(g, kept, US, DAY, null);
    expect(view.chart.map((r) => [r.artist.name, r.members])).toEqual([["A", 5], ["D", 2], ["B", 2], ["C", 2], ["Quiet", 2], ["Quiet2", 2]]);
    expect(view.recap).toBeNull();
  });

  it("recaps the week from a snapshot a week or more old", async () => {
    const kept = await filled(MIN_MEMBERS, (i) => [A, ...(i < 3 ? [B] : []), ...(i < 2 ? [C] : [])]);
    await kept.set(`community:${US.id}:chart:${DAY - 8}`, JSON.stringify([B, A, D, "gone"]), 99);
    const view = await viewOf(g, kept, US, DAY, null);
    expect(view.recap!.rose.map((m) => [m.artist.name, m.from, m.to])).toEqual([["A", 2, 1]]);
    expect(view.recap!.fell.map((m) => [m.artist.name, m.from, m.to])).toEqual([["B", 1, 2]]);
    expect(view.recap!.entered.map((a) => a.name)).toEqual(["C"]);
    expect(view.recap!.left.map((a) => a.name)).toEqual(["D"]);
    expect(JSON.parse((await kept.get(`community:${US.id}:chart:${DAY}`))!)).toEqual([A, B, C]);
    await kept.set(`community:${US.id}:chart:${DAY}`, JSON.stringify([C]), 99);
    await viewOf(g, kept, US, DAY, null);
    expect(JSON.parse((await kept.get(`community:${US.id}:chart:${DAY}`))!)).toEqual([C]);
  });

  it("says nothing moved when nothing did", () => {
    expect(recapOf(g, [A, B], [A, B])).toEqual({ rose: [], fell: [], entered: [], left: [] });
  });
});

describe("the route", () => {
  const SECRET = "s".repeat(32);
  const ORIGIN = "http://song.nexus";
  const ada = (domain: string | null) =>
    `${SESSION_COOKIE}=${sessionValue({ sub: "777", name: "Ada", picture: null, domain }, SECRET)}`;
  const call = async (
    route: (r: Request) => Promise<Response>,
    { query = "", method = "GET", body, cookie, origin = ORIGIN }: { query?: string; method?: string; body?: unknown; cookie?: string; origin?: string | null } = {},
  ) => {
    const headers: Record<string, string> = {};
    if (origin) headers.origin = origin;
    if (cookie) headers.cookie = cookie;
    const response = await route(new Request(`${ORIGIN}/api/discover/communities${query}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };

  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("SESSION_SECRET", SECRET);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await leaveAll(store()!, "777");
  });

  it("shows any community's chart to anyone, and what a signed-out visitor can do", async () => {
    expect(await call(communitiesRoute)).toEqual({ status: 200, body: { joined: [], campus: null, signedIn: false } });
    const view = await call(communitiesRoute, { query: "?id=country:SE" });
    expect(view.body).toMatchObject({ id: "country:SE", name: "Sweden", needed: MIN_MEMBERS, joined: false });
    expect((await call(communitiesRoute, { query: "?id=planet:mars" })).status).toBe(400);
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect((await call(communitiesRoute, { cookie: ada(null) })).body.signedIn).toBe(false);
  });

  it("lets a signed-in person join their own campus or any country, sharing artists in the catalog", async () => {
    const real = (await import("../lib/server")).graph().catalog.artists[0].id;
    expect((await call(communitiesRoute, { cookie: ada("wisc.edu") })).body).toEqual({ joined: [], campus: "campus:wisc.edu", signedIn: true });
    const joined = await call(joinRoute, { method: "POST", cookie: ada("wisc.edu"), body: { id: "campus:wisc.edu", artists: [real, "nope", 5] } });
    expect(joined.body).toMatchObject({ id: "campus:wisc.edu", members: 1, sharing: 1, joined: true });
    expect(await store()!.get("community:campus:wisc.edu:shared:777")).toBe(JSON.stringify([real]));
    await call(joinRoute, { method: "POST", cookie: ada("wisc.edu"), body: { id: "country:SE" } });
    const mine = await call(communitiesRoute, { cookie: ada("wisc.edu") });
    expect(mine.body.joined.map((v: { id: string }) => v.id)).toEqual(["campus:wisc.edu", "country:SE"]);
    expect((await call(leaveRoute, { method: "DELETE", query: "?id=country:SE", cookie: ada("wisc.edu") })).body).toEqual({ left: "country:SE" });
    expect(await memberships(store()!, "777")).toEqual(["campus:wisc.edu"]);
  });

  it("refuses another campus, odd communities, signed-out visitors and other sites", async () => {
    expect((await call(joinRoute, { method: "POST", cookie: ada("mit.edu"), body: { id: "campus:wisc.edu" } })).body.error).toBe(
      "Only people signed in with a wisc.edu account can join.",
    );
    expect((await call(joinRoute, { method: "POST", cookie: ada(null), body: { id: 5 } })).status).toBe(400);
    expect((await call(joinRoute, { method: "POST", body: { id: "country:SE" } })).status).toBe(401);
    expect((await call(joinRoute, { method: "POST", origin: null, body: {} })).status).toBe(403);
    expect((await call(leaveRoute, { method: "DELETE", query: "?id=country:SE" })).status).toBe(401);
    expect((await call(leaveRoute, { method: "DELETE", query: "?id=x", cookie: ada(null) })).status).toBe(400);
    expect((await call(leaveRoute, { method: "DELETE", cookie: ada(null) })).status).toBe(400);
    expect((await call(leaveRoute, { method: "DELETE", cookie: ada(null), origin: "https://evil.example" })).status).toBe(403);
  });

  it("leaves every community when the account is deleted", async () => {
    await join(store()!, "country:SE", "777", []);
    await call(deleteAccountRoute, { method: "DELETE", cookie: ada(null) });
    expect(await memberships(store()!, "777")).toEqual([]);
  });

  it("says Around You isn't set up without storage", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    expect((await call(communitiesRoute)).status).toBe(503);
    vi.unstubAllEnvs();
    expect(dayNumber(0)).toBe(0);
  });
});
