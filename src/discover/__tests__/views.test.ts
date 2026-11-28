import { describe, expect, it } from "vitest";
import { buildGraph } from "../lib/graph";
import { fitView, growWeb, layoutWeb, MAX_NODES, startWeb, zoomView } from "../lib/layout";
import { connectionsHref, sixDegreesHref } from "../lib/links";
import { normalize, searchCatalog } from "../lib/search";
import { neighborhood } from "../lib/server";
import { DEFAULT_CATEGORIES } from "../lib/types";
import { artistRef, countryName } from "../lib/words";
import { ANNA, artistId, BEN, CARA, DEV, fixture } from "./fixture";

const c = fixture();
const g = buildGraph(c);
const names = (text: string, kinds = ["artist", "song", "label", "genre"] as const) =>
  searchCatalog(c, text, kinds).map((r) => r.name);

describe("search", () => {
  it("ignores case, accents, punctuation and a leading The", () => {
    expect(normalize("Beyoncé & Jay‐Z’s")).toBe("beyonce and jay zs");
    expect(names("eve band")).toEqual(["The Eve Band"]);
    expect(names("SYNTHPOP")).toEqual(["synth-pop"]);
  });

  it("finds an artist by another of their names, and puts whole names first", () => {
    expect(names("anna svensson")).toEqual(["Anna"]);
    expect(names("pop")).toEqual(["pop", "synth-pop"]);
  });

  it("keeps to the kinds asked for, and finds nothing for nothing", () => {
    expect(searchCatalog(c, "first", ["artist"])).toEqual([]);
    expect(searchCatalog(c, "first", ["song"])).toMatchObject([
      { kind: "song", name: "First", note: "Anna" },
    ]);
    expect(names("  !!  ")).toEqual([]);
  });
});

describe("the connection web", () => {
  const web = startWeb(neighborhood(g, ANNA, DEFAULT_CATEGORIES, 20));

  it("is laid out the same way every time, around its artist, without overlaps", () => {
    const points = layoutWeb(web);
    expect(layoutWeb(web)).toEqual(points);
    expect(points.get(artistId(ANNA))).toEqual({ x: 0, y: 0 });
    const all = [...points.values()];
    all.forEach((p, i) =>
      all.slice(i + 1).forEach((q) => expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(40)),
    );
  });

  it("grows by an artist’s connections, once, up to its cap", () => {
    const grown = growWeb(web, neighborhood(g, DEV, DEFAULT_CATEGORIES, 20));
    expect(grown.nodes.map((n) => n.name)).toContain("The Eve Band");
    expect(new Set(grown.nodes.map((n) => n.id)).size).toBe(grown.nodes.length);
    expect(grown.opened).toEqual([artistId(ANNA), artistId(DEV)]);
    expect(growWeb(grown, neighborhood(g, DEV, DEFAULT_CATEGORIES, 20)).edges).toHaveLength(
      grown.edges.length,
    );
    const many = {
      center: artistId(BEN),
      total: 200,
      edges: [],
      nodes: Array.from({ length: 200 }, (_, i) => ({
        ...artistRef(c, BEN),
        id: `x${i}`,
        degree: 1,
      })),
    };
    expect(growWeb(web, many).nodes).toHaveLength(MAX_NODES);
  });

  it("zooms around a point, within limits, and fits everyone in view", () => {
    const view = { x: 0, y: 0, width: 1000, height: 500 };
    const closer = zoomView(view, 0.5, { x: 1000, y: 500 });
    expect(closer).toEqual({ x: 500, y: 250, width: 500, height: 250 });
    expect(zoomView(view, 0.001, { x: 0, y: 0 }).width).toBe(220);
    const fit = fitView(
      [
        { x: -300, y: 10 },
        { x: 200, y: 400 },
      ],
      50,
      50,
    );
    expect(fit).toEqual({ x: -350, y: -50, width: 600, height: 500 });
  });
});

it("addresses carry a whole search, and leave out what is default", () => {
  const state = {
    from: artistRef(c, ANNA),
    to: artistRef(c, BEN),
    categories: [...DEFAULT_CATEGORIES],
    order: "shortest" as const,
    avoid: [],
  };
  expect(sixDegreesHref(state)).toBe(
    `/discover/six-degrees?from=${artistId(ANNA)}&to=${artistId(BEN)}`,
  );
  expect(
    sixDegreesHref({
      ...state,
      order: "strongest",
      categories: ["bands"],
      avoid: [artistRef(c, CARA)],
    }),
  ).toBe(
    `/discover/six-degrees?from=${artistId(ANNA)}&to=${artistId(BEN)}&via=bands&order=strongest&avoid=${artistId(CARA)}`,
  );
  expect(connectionsHref("x", ["bands"])).toBe("/discover/connections?artist=x&via=bands");
});

it("names countries, and leaves out codes that aren’t one", () => {
  expect(countryName("SE")).toBe("Sweden");
  expect(countryName("XW")).toBeNull();
  expect(countryName(null)).toBeNull();
  expect(countryName("nonsense")).toBeNull();
});
