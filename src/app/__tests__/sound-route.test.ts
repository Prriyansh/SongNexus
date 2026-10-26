import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); vi.doUnmock("@/lib/sound"); });

async function route(result: unknown) {
  vi.doMock("@/lib/sound", () => ({ compareSound: vi.fn(async () => result) }));
  return (await import("../api/sound/route")).GET;
}
const url = (q: string) => new Request(`http://localhost/api/sound?${q}`);

describe("GET /api/sound", () => {
  it("needs both titles and caps lengths", async () => {
    const GET = await route({ status: "ok" });
    expect((await GET(url("aTitle=x"))).status).toBe(400);
    expect((await GET(url(`aTitle=x&bTitle=${"y".repeat(201)}`))).status).toBe(400);
  });

  it("returns the comparison with a long cache", async () => {
    const GET = await route({ status: "not-found", missing: ["b"] });
    const response = await GET(url("aTitle=a&aArtist=x&bTitle=b&bArtist=y"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "not-found", missing: ["b"] });
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("explains how to start the service in development, and doesn't cache that", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const GET = await route({ status: "unavailable" });
    const response = await GET(url("aTitle=a&bTitle=b"));
    expect((await response.json()).hint).toMatch(/python backend\/app\.py/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
