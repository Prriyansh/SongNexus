// The API routes' edges: what they refuse, cap, default and cache.
import { describe, expect, it } from "vitest";
import { GET as getNeighborhood } from "@/app/api/discover/neighborhood/route";
import { GET as getReasons } from "@/app/api/discover/reasons/route";
import { GET as getSearch } from "@/app/api/discover/search/route";
import { catalog } from "../lib/catalog";

const TAYLOR_SWIFT = "20244d07-534f-4eff-b4d4-930878889970";
type Handler = (request: Request) => Promise<Response>;

const call = async (handler: Handler, query: Record<string, string>) => {
  const response = await handler(new Request(`http://x/?${new URLSearchParams(query)}`));
  return { status: response.status, body: await response.json(), headers: response.headers };
};

describe("search", () => {
  it("takes 1 to 120 characters", async () => {
    for (const q of ["", "   ", "x".repeat(121)]) {
      const { status, body } = await call(getSearch, { q });
      expect(status).toBe(400);
      expect(body.error).toContain("1–120");
    }
    expect((await call(getSearch, { q: "x".repeat(120) })).status).toBe(200);
    expect((await call(getSearch, {})).status).toBe(400);
  });

  it("looks through every kind unless told which, ignoring made-up ones", async () => {
    const kinds = async (asked: Record<string, string>) =>
      new Set(
        (await call(getSearch, { q: "pop", ...asked })).body.results.map(
          (r: { kind: string }) => r.kind,
        ),
      );
    expect((await kinds({})).size).toBeGreaterThan(1);
    expect(await kinds({ kinds: "genre" })).toEqual(new Set(["genre"]));
    expect(await kinds({ kinds: "genre,nope" })).toEqual(new Set(["genre"]));
    expect((await kinds({ kinds: "nope" })).size).toBeGreaterThan(1);
  });

  it("returns at most a dozen, and survives any text", async () => {
    expect((await call(getSearch, { q: "a" })).body.results).toHaveLength(12);
    for (const q of [
      "%",
      "\\",
      "'; drop table",
      "<script>",
      "🎵",
      "\u0000",
      "(.*)",
      "방탄소년단",
    ]) {
      expect((await call(getSearch, { q })).status).toBe(200);
    }
  });
});

describe("connections", () => {
  it.each([
    ["", 20],
    ["abc", 20],
    ["0", 20],
    ["-5", 20],
    ["2.5", 20],
    ["1", 1],
    ["40", 40],
    ["41", 40],
    ["1e9", 40],
  ])("a limit of %j means %i", async (limit, expected) => {
    const { body } = await call(getNeighborhood, { artist: TAYLOR_SWIFT, limit });
    expect(body.nodes).toHaveLength(expected + 1);
    expect(body.total).toBeGreaterThanOrEqual(expected);
  });

  it("counts only the kinds asked for, and takes an ID in capitals", async () => {
    const bands = await call(getNeighborhood, {
      artist: TAYLOR_SWIFT.toUpperCase(),
      categories: "bands",
    });
    expect(bands.status).toBe(200);
    expect(bands.body.center).toBe(TAYLOR_SWIFT);
    for (const e of bands.body.edges) expect(e.category).toBe("bands");
    const all = await call(getNeighborhood, { artist: TAYLOR_SWIFT });
    expect(all.body.total).toBeGreaterThan(bands.body.total);
  });

  it("doesn’t know made-up artists", async () => {
    for (const artist of ["", "nope", "__proto__", "constructor"]) {
      const { status, body } = await call(getNeighborhood, { artist });
      expect(status).toBe(404);
      expect(body.error).toBeTruthy();
    }
  });
});

describe("reasons", () => {
  it("need two known artists, and are the same whichever comes first", async () => {
    const { body } = await call(getNeighborhood, { artist: TAYLOR_SWIFT, limit: "1" });
    const other = body.nodes[1].id;
    const there = await call(getReasons, { a: TAYLOR_SWIFT, b: other });
    const back = await call(getReasons, { a: other, b: TAYLOR_SWIFT });
    expect(there.body.total).toBe(back.body.total);
    expect(new Set(there.body.reasons.map((r: { text: string }) => r.text)).size).toBeGreaterThan(
      0,
    );
    expect(there.body.reasons.length).toBeLessThanOrEqual(8);
    expect((await call(getReasons, { a: TAYLOR_SWIFT })).status).toBe(404);
    expect((await call(getReasons, { a: "nope", b: other })).status).toBe(404);
  });

  it("are none for two artists who never met", async () => {
    const c = catalog();
    const stranger = c.artists.find((a) => a.level === 0)!;
    const { status, body } = await call(getReasons, {
      a: TAYLOR_SWIFT,
      b: stranger.id,
      categories: "bands",
    });
    expect([status, body.total]).toEqual([200, 0]);
  });
});

describe("caching", () => {
  it.each([
    ["search", getSearch, { q: "queen" }],
    ["neighborhood", getNeighborhood, { artist: TAYLOR_SWIFT }],
    ["reasons", getReasons, { a: TAYLOR_SWIFT, b: TAYLOR_SWIFT }],
  ] as const)("%s answers are kept, errors aren’t", async (_, handler, query) => {
    const good = await call(handler, query as Record<string, string>);
    expect(good.headers.get("cache-control")).toMatch(/public, max-age=\d+, s-maxage=\d+/);
    expect((await call(handler, {})).headers.get("cache-control")).toBeNull();
  });
});
