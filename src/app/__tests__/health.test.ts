// The health check: what a deployment has switched on and what it is set up wrong for, never a secret.
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (actual) => ({ ...(await actual<object>()), connection: async () => {} }));

import { GET, healthOf, storageOf } from "../api/health/route";

const REDIS = { KV_REST_API_URL: "https://redis", KV_REST_API_TOKEN: "secret-token" };

describe("the health check", () => {
  it("says where shared data lives", () => {
    expect(storageOf(REDIS)).toBe("redis");
    expect(storageOf({ UPSTASH_REDIS_REST_URL: "https://r", UPSTASH_REDIS_REST_TOKEN: "t" })).toBe("redis");
    expect(storageOf({ KV_REST_API_URL: "https://redis" })).toBe("memory");
    expect(storageOf({ NODE_ENV: "production" })).toBe("none");
    expect(storageOf({ NODE_ENV: "production", SONG_NEXUS_MEMORY_STORE: "1" })).toBe("memory");
  });

  it("finds nothing wrong with a full production setup, and shows no secret", () => {
    const env = {
      ...REDIS,
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "0123456789abcdef",
      GOOGLE_CLIENT_ID: "client",
      SESSION_SECRET: "s".repeat(40),
      GEMINI_API_KEY: "gemini-secret",
      LASTFM_API_KEY: "lastfm-secret",
      GENIUS_ACCESS_TOKEN: "genius-secret",
      DISCOGS_TOKEN: "discogs-secret",
      SONG_COMPARE_URL: "https://sound",
    };
    const health = healthOf(env);
    expect(health).toMatchObject({ ok: true, version: "0123456", environment: "preview", storage: "redis", problems: [] });
    expect(Object.values(health.features).every(Boolean)).toBe(true);
    expect(health.catalog.artists).toBeGreaterThan(1000);
    expect(JSON.stringify(health)).not.toMatch(/secret|sss/);
  });

  it("names what a production setup is missing", () => {
    const bare = healthOf({ NODE_ENV: "production", GOOGLE_CLIENT_ID: "client", SESSION_SECRET: "short" });
    expect(bare.ok).toBe(false);
    expect(bare.problems).toEqual([
      "GOOGLE_CLIENT_ID is set, but SESSION_SECRET is missing or shorter than 32 characters, so sign-in is off.",
      "No Redis: leaderboards, accounts and Around You are off, and Friends falls back to long links.",
    ]);
    expect(bare.features).toMatchObject({ leaderboards: false, accounts: false, aroundYou: false, aiSearch: false, soundService: false });
    expect([bare.version, bare.environment]).toEqual([null, "production"]);
    const memory = healthOf({ NODE_ENV: "production", SONG_NEXUS_MEMORY_STORE: "1", GOOGLE_CLIENT_ID: "c", SESSION_SECRET: "s".repeat(32) });
    expect(memory.problems).toEqual(["Memory storage in production: each server instance has its own, and all of it goes on a restart."]);
    expect(memory.features.accounts).toBe(true);
  });

  it("is quiet in development", () => {
    const dev = healthOf({ NODE_ENV: "development" });
    expect(dev).toMatchObject({ ok: true, storage: "memory", features: { soundService: true } });
    expect(healthOf({}).environment).toBeNull();
  });

  it("answers over HTTP without being cached", async () => {
    const response = await GET();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toHaveProperty("features");
  });
});
