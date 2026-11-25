import { describe, expect, it } from "vitest";
import { collaborations, timeline } from "../lib/collaborations";
import { creditGroups } from "../lib/credits";
import { buildGraph, evidenceBetween, neighbors, strengthOf } from "../lib/graph";
import { findPath, findPaths } from "../lib/paths";
import { neighborhood, searchPaths } from "../lib/server";
import { CATEGORIES, DEFAULT_CATEGORIES, parseCategories } from "../lib/types";
import { reasonOf } from "../lib/words";
import { ANNA, BEN, CARA, DEV, EVE, FAY, fixture, GUS } from "./fixture";

const c = fixture();
const g = buildGraph(c);
const reasons = (a: number, b: number) =>
  evidenceBetween(c, a, b, CATEGORIES).map((e) => reasonOf(c, e).text);

describe("connections", () => {
  it("come from credits that involve a performer", () => {
    expect(
      neighbors(g, ANNA, DEFAULT_CATEGORIES)
        .map((n) => n.artist)
        .sort(),
    ).toEqual([BEN, CARA, DEV].sort());
    // Ben is featured where Cara produced, so those two are connected as well.
    expect(g.edges[BEN].has(CARA)).toBe(true);
    // Two people behind the scenes of one song aren't.
    expect(g.edges[CARA].has(GUS)).toBe(false);
  });

  it("weigh more with every fact, and engineering and labels only count when asked for", () => {
    expect(strengthOf(g.edges[CARA].get(DEV)!, DEFAULT_CATEGORIES)).toBe(2);
    expect(neighbors(g, GUS, DEFAULT_CATEGORIES)).toEqual([]);
    expect(
      neighbors(g, GUS, ["engineering"])
        .map((n) => n.artist)
        .sort(),
    ).toEqual([ANNA, BEN].sort());
  });

  it("make label mates only of albums a few years apart", () => {
    expect(neighbors(g, FAY, CATEGORIES).map((n) => n.artist)).toEqual([ANNA]); // 2001 and 2003, not Dev's 2020
  });

  it("are explained in words, with what they are about", () => {
    expect(reasons(ANNA, BEN)).toEqual(["Ben is featured on “First” by Anna"]);
    expect(reasons(CARA, DEV)).toEqual([
      "Cara produced “Second” by Dev",
      "Cara produced “Third” by Dev",
    ]);
    expect(reasons(ANNA, DEV)).toEqual(["Anna is credited with guitar on “Second” by Dev"]);
    expect(reasons(BEN, DEV)).toEqual(["“Third” by Dev samples Ben"]);
    expect(reasons(DEV, EVE)).toEqual(["Dev is or was a member of The Eve Band"]);
    expect(reasons(GUS, ANNA)).toEqual(["Gus engineered “First” by Anna"]);
    expect(reasons(FAY, ANNA)).toEqual([
      "Anna and Fay released albums on Small Label within three years of each other",
    ]);
  });

  it("always have the evidence behind their strength", () => {
    c.artists.forEach((_, a) =>
      g.edges[a].forEach((edge, b) => {
        const counted = [...edge.count].reduce((sum, n) => sum + n, 0);
        expect(evidenceBetween(c, a, b, CATEGORIES)).toHaveLength(counted);
      }),
    );
  });
});

describe("paths", () => {
  const categories = DEFAULT_CATEGORIES;

  it("take the fewest steps, or the closest connections", () => {
    expect(findPath(g, BEN, EVE, { categories })).toEqual([BEN, DEV, EVE]); // through the sample
    // Cara produced twice for Dev and once with Ben: closer than one sample.
    expect(findPath(g, BEN, EVE, { categories, order: "strongest" })).toEqual([
      BEN,
      CARA,
      DEV,
      EVE,
    ]);
  });

  it("keep to the kinds of connection, the step limit and the artists asked for", () => {
    expect(findPath(g, BEN, EVE, { categories: ["samples"] })).toBeNull();
    expect(findPath(g, BEN, EVE, { categories, maxSteps: 1 })).toBeNull();
    expect(findPath(g, BEN, EVE, { categories, avoid: new Set([DEV]) })).toBeNull();
    // Avoiding the destination itself makes no sense, so it is ignored.
    expect(findPath(g, ANNA, BEN, { categories, avoid: new Set([BEN]) })).toEqual([ANNA, BEN]);
  });

  it("offer other ways through other people, and only one answer for a direct connection", () => {
    expect(findPaths(g, ANNA, DEV, { categories })).toEqual([[ANNA, DEV]]);
    const ways = findPaths(g, BEN, DEV, { categories: ["features", "producers", "contributions"] });
    expect(ways).toHaveLength(2);
    expect(new Set(ways.flatMap((way) => way.slice(1, -1))).size).toBe(2);
  });

  it("report the same artist and no connection as such", () => {
    expect(searchPaths(g, ANNA, ANNA, categories, "shortest")).toEqual({ status: "same-artist" });
    expect(searchPaths(g, ANNA, FAY, categories, "shortest")).toEqual({ status: "not-connected" });
    const found = searchPaths(g, ANNA, EVE, categories, "shortest");
    expect(found.status === "ok" && found.paths[0].artists.map((a) => a.name)).toEqual([
      "Anna",
      "Dev",
      "The Eve Band",
    ]);
  });
});

describe("collaborations", () => {
  it("count songs and albums once, with their years and who produced whom", () => {
    expect(collaborations(g, DEV, "production", 5)).toMatchObject({
      total: 1,
      items: [
        {
          artist: { name: "Cara" },
          count: 2,
          firstYear: 2003,
          lastYear: 2004,
          directions: ["produced by them"],
        },
      ],
    });
    expect(collaborations(g, CARA, "production", 1)).toMatchObject({
      total: 3,
      items: [{ artist: { name: "Dev" }, directions: ["produced for them"] }],
    });
  });

  it("add up by year", () => {
    expect(timeline(g, ANNA)).toEqual([
      { year: 2001, count: 1 },
      { year: 2003, count: 1 },
    ]);
  });

  it("show a web of the closest artists and the links among them", () => {
    const web = neighborhood(g, ANNA, DEFAULT_CATEGORIES, 2);
    expect(web.total).toBe(3);
    expect(web.nodes).toHaveLength(3);
    expect(
      web.edges.every(
        (e) => web.nodes.some((n) => n.id === e.a) && web.nodes.some((n) => n.id === e.b),
      ),
    ).toBe(true);
  });
});

it("a song’s credits name each person once per group, with their parts", () => {
  const credit = (artist: number, role: string, detail = "") => ({ artist, role, detail });
  expect(
    creditGroups([
      credit(1, "instrument", "guitar"),
      credit(1, "instrument", "piano"),
      credit(1, "vocal"),
      credit(2, "primary"),
      credit(1, "producer"),
    ]),
  ).toEqual([
    { title: "Performers", people: [{ artist: 2, parts: [] }] },
    { title: "Producers", people: [{ artist: 1, parts: [] }] },
    {
      title: "Vocals and instruments",
      people: [{ artist: 1, parts: ["vocals", "guitar", "piano"] }],
    },
  ]);
});

it("reads the kinds of connection from an address, falling back to the defaults", () => {
  expect(parseCategories("bands,features,nope")).toEqual(["features", "bands"]);
  expect(parseCategories("nope")).toEqual(DEFAULT_CATEGORIES);
  expect(parseCategories(null)).toEqual(DEFAULT_CATEGORIES);
});
