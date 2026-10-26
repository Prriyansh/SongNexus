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

describe("GET /api/sound/search", () => {
  async function searchRoute(result: unknown) {
    const searchSound = vi.fn(async () => result);
    vi.doMock("@/lib/sound", () => ({ searchSound }));
    return { GET: (await import("../api/sound/search/route")).GET, searchSound };
  }

  it("validates the query and clamps the limit", async () => {
    const { GET, searchSound } = await searchRoute({ status: "ok", results: [] });
    expect((await GET(new Request("http://localhost/api/sound/search?q=a"))).status).toBe(400);
    await GET(new Request("http://localhost/api/sound/search?q=drivers&limit=500"));
    expect(searchSound).toHaveBeenCalledWith("drivers", 25);
  });

  it("caches results but not an unavailable service", async () => {
    let { GET } = await searchRoute({ status: "ok", results: [] });
    expect((await GET(new Request("http://localhost/api/sound/search?q=drivers"))).headers.get("cache-control")).toBe("public, max-age=3600");
    vi.resetModules();
    ({ GET } = await searchRoute({ status: "unavailable" }));
    const response = await GET(new Request("http://localhost/api/sound/search?q=drivers"));
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

