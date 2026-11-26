// Small cases in Discover's library that the other tests' catalogs don't have: undated credits,
// a label too broad to count, an unknown relationship, a search for labels, empty addresses.
import { describe, expect, it } from "vitest";
import { surprisePairs } from "../lib/browse";
import { buildCatalog, type RawCatalog } from "../lib/catalog";
import { timeline } from "../lib/collaborations";
import { buildGraph, evidenceBetween, MAX_LABEL_ARTISTS } from "../lib/graph";
import { growWeb, layoutWeb, separate, startWeb } from "../lib/layout";
import { sixDegreesHref } from "../lib/links";
import { searchCatalog } from "../lib/search";
import { neighborhood } from "../lib/server";
import { CATEGORIES, DEFAULT_CATEGORIES } from "../lib/types";
import { artistRef, countryName } from "../lib/words";
import { ANNA, artistId, BEN, fixture } from "./fixture";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const artistRow = (at: number): RawCatalog["artists"][number] => [uuid(100 + at), `Artist ${at}`, "Person", "SE", null, null, null, 2, null, [], []];

/** A catalog of `count` artists and whatever else it's given. */
function catalogOf(count: number, more: Partial<RawCatalog>) {
  return buildCatalog({
    version: 1,
    roles: ["primary", "featured"],
    details: [""],
    relationTypes: ["member_of", "mystery"],
    artists: Array.from({ length: count }, (_, at) => artistRow(at)),
    extras: {},
    photos: {},
    genres: [],
    labels: [],
    songs: [],
    releases: [],
    relations: [],
    ...more,
  });
}

describe("facts with something missing", () => {
  it("put undated songs on no year of a timeline", () => {
    const c = catalogOf(2, { songs: [[uuid(200), "Undated", null, null, [0, 0, 0, 1, 1, 0]]] });
    expect(timeline(buildGraph(c), 0)).toEqual([]);
  });

  it("make label mates only of dated albums, and not on a label too broad to mean anything", () => {
    const releases = (label: number, years: (number | null)[], first: number) =>
      years.map((year, i): RawCatalog["releases"][number] => [uuid(300 + first + i), `R${first + i}`, year, null, [first + i], [label], [], []]);
    const broad = MAX_LABEL_ARTISTS + 1;
    const c = catalogOf(broad + 3, {
      labels: [[uuid(1), "Broad"], [uuid(2), "Small"]],
      releases: [
        ...releases(0, Array(broad).fill(2000), 0),
        ...releases(1, [2001, 2002, null], broad),
      ],
    });
    const g = buildGraph(c);
    expect(evidenceBetween(c, 0, 1, CATEGORIES)).toEqual([]); // both on Broad, which has too many artists
    expect(evidenceBetween(c, broad, broad + 1, CATEGORIES).map((e) => e.kind)).toEqual(["label_mates"]);
    expect(evidenceBetween(c, broad, broad + 2, CATEGORIES)).toEqual([]); // undated: no years to compare
    expect(g).toBeDefined();
  });

  it("ignore relationships of a kind the graph doesn't know", () => {
    expect(evidenceBetween(catalogOf(2, { relations: [[0, 1, 1, null, null]] }), 0, 1, CATEGORIES)).toEqual([]);
  });

  it("name no country for a code nobody uses", () => {
    expect(countryName("AA")).toBeNull();
  });
});

describe("ways in", () => {
  it("start no surprise pair from an artist without a main genre", () => {
    const g = buildGraph(fixture());
    expect(surprisePairs(g).some((p) => p.from.id === artistId(BEN))).toBe(false);
  });

  it("find labels by name", () => {
    expect(searchCatalog(fixture(), "small", ["label"])).toEqual([{ kind: "label", id: uuid(1), name: "Small Label", note: "Record label" }]);
  });

  it("leave out of a Six Degrees address what isn't chosen", () => {
    const anna = artistRef(fixture(), ANNA);
    expect(sixDegreesHref({ from: null, to: null })).toBe("/discover/six-degrees");
    expect(sixDegreesHref({ from: anna, to: null })).toBe(`/discover/six-degrees?from=${anna.id}`);
  });
});

describe("the web's layout", () => {
  const g = buildGraph(fixture());
  const around = (at: number) => neighborhood(g, at, DEFAULT_CATEGORIES, 12);

  it("keeps lines only between artists on the web", () => {
    const start = startWeb(around(ANNA));
    const data = around(ANNA);
    const grown = growWeb(start, { ...data, edges: [...data.edges, { ...data.edges[0], b: "someone-not-here" }] });
    expect(grown.edges.every((e) => grown.nodes.some((n) => n.id === e.b))).toBe(true);
  });

  it("places newcomers beside whoever they're linked to, from either end of the line", () => {
    const web = startWeb(around(ANNA));
    const [first] = web.nodes;
    const flipped = { ...web, edges: web.edges.map((e, i) => (i % 2 ? { ...e, a: e.b, b: e.a } : e)) };
    const points = layoutWeb(flipped, new Map([[first.id, { x: 0, y: 0 }]]));
    expect([...points.keys()].sort()).toEqual(web.nodes.map((n) => n.id).sort());
  });

  it("never moves the middle artist when pushing two apart", () => {
    const x = new Float64Array([0, 0]);
    const y = new Float64Array([0, 0]);
    separate(x, y, 0);
    expect([x[0], y[0]]).toEqual([0, 0]);
    expect(Math.hypot(x[1], y[1])).toBeGreaterThan(0);
    // Whichever of the two it is.
    const [x2, y2] = [new Float64Array([5, 5]), new Float64Array([5, 5])];
    separate(x2, y2, 1);
    expect([x2[1], y2[1]]).toEqual([5, 5]);
    expect(Math.hypot(x2[0] - 5, y2[0] - 5)).toBeGreaterThan(0);
  });
});
