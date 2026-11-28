// Per-visitor limits: who is asking, counting in storage or per instance, and every limited route
// answering 429 once a visitor is over.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT as dataRoute } from "@/app/api/discover/account/data/route";
import { POST as signInRoute } from "@/app/api/discover/account/session/route";
import { DELETE as leaveRoute, POST as joinRoute } from "@/app/api/discover/communities/route";
import { POST as answerRoute } from "@/app/api/discover/games/answer/route";
import { POST as scoreRoute } from "@/app/api/discover/games/score/route";
import { POST as stepRoute } from "@/app/api/discover/games/step/route";
import { GET as listeningRoute } from "@/app/api/discover/listening/route";
import { GET as nexusRoute } from "@/app/api/discover/nexus/route";
import { askWithAi, forgetReadings } from "../lib/ai-ask";
import { SESSION_COOKIE, sessionValue } from "../lib/auth";
import { forgetCounts, LIMITS, tooMany, visitorOf, withinLimit, type Limit } from "../lib/limits";
import { graph } from "../lib/server";
import { memoryStore, store } from "../lib/store";

const IP = "198.51.100.23";
const HOUR = 3_600_000;

afterEach(() => {
  forgetCounts();
  vi.unstubAllEnvs();
});

describe("who is asking", () => {
  it("is the first address forwarded, or the real IP, or unknown", () => {
    expect(visitorOf(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(visitorOf(new Headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(visitorOf(new Headers({ "x-forwarded-for": "<script>" }))).toBe("unknown");
    expect(visitorOf(new Headers())).toBe("unknown");
  });
});

describe("counting", () => {
  const tight: Limit = { name: "test", max: 2, seconds: 3600 };

  it("allows so many an hour in shared storage, then again the next hour", async () => {
    const kept = memoryStore();
    const tries = [0, 1, 2].map(() => withinLimit(IP, tight, kept, 0));
    expect(await Promise.all(tries)).toEqual([true, true, false]);
    expect(await withinLimit("another", tight, kept, 0)).toBe(true);
    expect(await withinLimit(IP, tight, kept, HOUR)).toBe(true);
  });

  it("counts per instance without storage, forgetting everything once there's too much to keep", async () => {
    for (let i = 0; i < 2; i++) await withinLimit(IP, tight, null, 0);
    expect(await withinLimit(IP, tight, null, 0)).toBe(false);
    for (let i = 0; i < 10_000; i++) await withinLimit(`v${i}`, tight, null, 0);
    expect(await withinLimit(IP, tight, null, 0)).toBe(true);
  });

  it("answers 429 with when to try again", async () => {
    const kept = memoryStore();
    const request = new Request("http://x/", { headers: { "x-forwarded-for": IP } });
    for (let i = 0; i < 2; i++) expect(await tooMany(request, tight, kept, 1000)).toBeNull();
    const refused = (await tooMany(request, tight, kept, 1000))!;
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("3599");
    expect((await refused.json()).error).toContain("Try again a little later");
  });
});

describe("every limited route", () => {
  const SECRET = "s".repeat(32);
  const cookie = `${SESSION_COOKIE}=${sessionValue({ sub: "1", name: "A", picture: null, domain: null }, SECRET)}`;
  /** Puts this visitor at the limit, so their next request is over it. */
  const exhaust = async ({ name, max, seconds }: Limit) =>
    store()!.set(`limit:${name}:${IP}:${Math.floor(Date.now() / (seconds * 1000))}`, String(max), seconds);
  const request = (method: string, path = "/", body?: unknown) =>
    new Request(`http://song.nexus/api${path}`, {
      method,
      headers: { "x-forwarded-for": IP, origin: "http://song.nexus", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("SESSION_SECRET", SECRET);
  });

  it.each([
    ["a Connect step", LIMITS.play, () => stepRoute(request("POST", "/", {}))],
    ["a quiz answer", LIMITS.play, () => answerRoute(request("POST", "/", {}))],
    ["a score", LIMITS.score, () => scoreRoute(request("POST", "/", {}))],
    ["a sign-in", LIMITS.signIn, () => signInRoute(request("POST", "/", {}))],
    ["a save", LIMITS.sync, () => dataRoute(request("PUT", "/", {}))],
    ["joining a community", LIMITS.community, () => joinRoute(request("POST", "/", { id: "country:SE" }))],
    ["leaving a community", LIMITS.community, () => leaveRoute(request("DELETE", "?id=country:SE"))],
    ["reading listening", LIMITS.listening, () => listeningRoute(request("GET", "?service=listenbrainz&user=rob"))],
    ["Your Nexus", LIMITS.nexus, () => nexusRoute(request("GET", "?artists="))],
  ])("refuses %s over its limit", async (_what, limit, call) => {
    await exhaust(limit);
    const response = await call();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("stops reading questions with AI for a visitor over theirs", async () => {
    forgetReadings();
    await exhaust(LIMITS.ai);
    const read = vi.fn(async () => ({ intent: "lookup", text: "Adele" }) as const);
    const asked = await askWithAi(graph(), "what is the meaning of life", { read, env: { GEMINI_API_KEY: "k" }, kept: store(), visitor: IP });
    expect(asked.ai).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
});
