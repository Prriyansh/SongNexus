// The committed catalog itself, and the API over it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET as getNeighborhood } from "@/app/api/discover/neighborhood/route";
import { GET as getReasons } from "@/app/api/discover/reasons/route";
import { GET as getSearch } from "@/app/api/discover/search/route";
import { surprisePairs } from "../lib/browse";
import { catalog } from "../lib/catalog";
import { searchCatalog } from "../lib/search";
import { graph, searchPaths } from "../lib/server";
import { DEFAULT_CATEGORIES } from "../lib/types";

const c = catalog();
const find = (name: string) => c.artistAt.get(searchCatalog(c, name, ["artist"])[0].id)!;
const TAYLOR_SWIFT = "20244d07-534f-4eff-b4d4-930878889970";

describe("the catalog file", () => {
  it("uses MusicBrainz IDs, each once", () => {
    const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
    for (const list of [c.artists, c.songs, c.releases, c.labels]) {
      expect(list.every((x) => uuid.test(x.id))).toBe(true);
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    }
    expect(new Set(c.genres.map((x) => x.slug)).size).toBe(c.genres.length);
  });

  it("points only at things it has", () => {
    const within = (at: number, list: unknown[]) => at >= 0 && at < list.length;
    expect(
      c.songs.every((s) => s.credits.every((x) => within(x.artist, c.artists) && x.role)),
    ).toBe(true);
    expect(
      c.releases.every(
        (r) =>
          r.artists.every((a) => within(a, c.artists)) &&
          r.tracks.every((s) => within(s, c.songs)) &&
          r.labels.every((l) => within(l, c.labels)),
      ),
    ).toBe(true);
    expect(c.artists.every((a) => a.genres.every((x) => within(x.genre, c.genres)))).toBe(true);
    expect(
      c.relations.every((r) => within(r.subject, c.artists) && within(r.object, c.artists)),
    ).toBe(true);
  });

  it("leaves out placeholders, lyrics and album-by-album chart data", () => {
    expect(c.artists.filter((a) => a.name.startsWith("["))).toEqual([]);
    const file = JSON.parse(readFileSync("src/discover/data/catalog.json", "utf8"));
    expect(Object.keys(file).sort()).toEqual([
      "artists",
      "details",
      "extras",
      "genres",
      "labels",
      "photos",
      "relationTypes",
      "relations",
      "releases",
      "roles",
      "songs",
      "version",
    ]);
    const extras = new Set(c.artists.flatMap((a) => Object.keys(a.extras)));
    expect([...extras].sort()).toEqual([
      "albums",
      "eurovision",
      "eventCount",
      "events",
      "facts",
      "hot100",
    ]);
  });

  it("credits every photo, and only takes freely licensed ones from Commons", () => {
    const photos = c.artists.flatMap((a) => a.photo ?? []);
    expect(photos.length).toBeGreaterThan(1000);
    for (const photo of photos) {
      expect(photo.url).toMatch(/^https:\/\/(upload|thumb)\.wikimedia\.org\//);
      expect(photo.page).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
      expect(photo.license).toMatch(/^(CC0|CC BY|Public domain|PDM|No restrictions|Attribution)/i);
      // A license that asks for credit needs someone to credit.
      if (/^CC BY/.test(photo.license)) expect(photo.author).toBeTruthy();
    }
  });

  it("connects well-known artists through real credits", () => {
    const result = searchPaths(
      graph(),
      find("Taylor Swift"),
      find("Kendrick Lamar"),
      DEFAULT_CATEGORIES,
      "shortest",
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.paths[0].steps).toHaveLength(2);
    expect(result.paths.every((p) => p.steps.every((s) => s.reasons.length > 0))).toBe(true);
  });

  it("offers surprise pairs that are connected", () => {
    const pairs = surprisePairs(graph());
    expect(pairs.length).toBeGreaterThan(10);
    for (const { from, to } of pairs) {
      expect(
        searchPaths(
          graph(),
          c.artistAt.get(from.id)!,
          c.artistAt.get(to.id)!,
          DEFAULT_CATEGORIES,
          "shortest",
        ).status,
      ).toBe("ok");
    }
  }, 20_000); // A path search per pair over the whole catalog: under 1 s alone, slower beside the full suite.
});

describe("the API", () => {
  const call = async (handler: (request: Request) => Promise<Response>, query: string) => {
    const response = await handler(new Request(`http://x/api/discover?${query}`));
    return { status: response.status, body: await response.json() };
  };

  it("searches names, and rejects an empty or very long search", async () => {
    expect((await call(getSearch, "q=taylor+swift&kinds=artist")).body.results[0]).toMatchObject({
      id: TAYLOR_SWIFT,
      name: "Taylor Swift",
    });
    expect((await call(getSearch, "q=")).status).toBe(400);
    expect((await call(getSearch, `q=${"x".repeat(200)}`)).status).toBe(400);
  });

  it("returns an artist’s connections, limited, and says when it doesn’t know them", async () => {
    const { body } = await call(getNeighborhood, `artist=${TAYLOR_SWIFT}&limit=5`);
    expect(body.nodes).toHaveLength(6);
    expect(
      (await call(getNeighborhood, `artist=${TAYLOR_SWIFT}&limit=9999`)).body.nodes.length,
    ).toBeLessThanOrEqual(41);
    expect((await call(getNeighborhood, "artist=nope")).status).toBe(404);
  });

  it("explains a connection", async () => {
    const { body } = await call(getNeighborhood, `artist=${TAYLOR_SWIFT}&limit=1`);
    const other = body.nodes[1].id;
    const why = await call(getReasons, `a=${TAYLOR_SWIFT}&b=${other}`);
    expect(why.body.total).toBeGreaterThan(0);
    expect(why.body.reasons[0].text).toContain(" ");
    expect((await call(getReasons, `a=${TAYLOR_SWIFT}&b=nope`)).status).toBe(404);
  });
});
