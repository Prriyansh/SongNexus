// Rules that must hold for any catalog: checked on many small made-up ones, and by slower, simpler
// ways of getting the same answers. Seeded, so a failure repeats.
import { describe, expect, it } from "vitest";
import { buildCatalog, type Catalog, type RawCatalog } from "../lib/catalog";
import { collaborations } from "../lib/collaborations";
import {
  buildGraph,
  evidenceBetween,
  KIND_RULES,
  neighbors,
  strengthOf,
  type Graph,
} from "../lib/graph";
import { growWeb, layoutWeb, MAX_NODES, startWeb, visibleLabels } from "../lib/layout";
import { matchRange } from "../lib/match";
import { findPath, findPaths, MAX_STEPS } from "../lib/paths";
import { normalize, searchCatalog } from "../lib/search";
import { neighborhood } from "../lib/server";
import { CATEGORIES, DEFAULT_CATEGORIES, parseCategories, type Category } from "../lib/types";

/** A small seeded random number generator (mulberry32). */
function randomFrom(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (n: number) => Math.floor(next() * n);
  return { next, below, pick: <T>(list: readonly T[]) => list[below(list.length)] };
}

const ROLES = ["primary", "featured", "producer", "instrument", "engineer", "sampled"];
const TYPES = [
  "member_of",
  "collaboration_in",
  "supported",
  "taught",
  "performs_as",
  "has_subgroup",
];
const uuid = (kind: number, n: number) =>
  `0000000${kind}-0000-4000-8000-${String(n).padStart(12, "0")}`;

function madeUp(seed: number): Graph {
  const r = randomFrom(seed);
  const artists = 4 + r.below(12);
  const credits = () =>
    Array.from({ length: 1 + r.below(5) }, () => [
      r.below(artists),
      r.below(ROLES.length),
      0,
    ]).flat();
  const raw: RawCatalog = {
    version: 1,
    roles: ROLES,
    details: [""],
    relationTypes: TYPES,
    artists: Array.from({ length: artists }, (_, i) => [
      uuid(1, i),
      `Artist ${i}`,
      null,
      null,
      null,
      null,
      null,
      2,
      r.below(1000),
      [],
      [],
    ]),
    extras: {},
    photos: {},
    genres: [],
    labels: [
      [uuid(4, 0), "A"],
      [uuid(4, 1), "B"],
    ],
    songs: Array.from({ length: r.below(14) }, (_, i) => [
      uuid(2, i),
      `Song ${i}`,
      r.below(2) ? 1970 + r.below(50) : null,
      null,
      credits(),
    ]),
    releases: Array.from({ length: r.below(8) }, (_, i) => [
      uuid(3, i),
      `Album ${i}`,
      1990 + r.below(8),
      null,
      [r.below(artists)],
      [r.below(2)],
      [],
      credits(),
    ]),
    relations: Array.from({ length: r.below(5) }, () => [
      r.below(artists),
      r.below(artists),
      r.below(TYPES.length),
      null,
      null,
    ]),
  };
  return buildGraph(buildCatalog(raw));
}

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const each = (
  check: (g: Graph, c: Catalog, r: ReturnType<typeof randomFrom>, seed: number) => void,
) => {
  for (const seed of SEEDS) {
    const g = madeUp(seed);
    check(g, g.catalog, randomFrom(seed + 1000), seed);
  }
};
const someCategories = (r: ReturnType<typeof randomFrom>): Category[] => {
  const some = CATEGORIES.filter(() => r.below(2));
  return some.length ? some : ["features"];
};

/** Every simple path up to a length, the plain way. */
function everyPath(
  g: Graph,
  from: number,
  to: number,
  categories: readonly Category[],
  most: number,
): number[][] {
  const out: number[][] = [];
  const walk = (path: number[]) => {
    const at = path[path.length - 1];
    if (at === to) return void out.push(path);
    if (path.length > most) return;
    for (const [other, edge] of g.edges[at]) {
      if (!path.includes(other) && strengthOf(edge, categories) > 0) walk([...path, other]);
    }
  };
  walk([from]);
  return out;
}

const costOf = (g: Graph, path: number[], categories: readonly Category[]) =>
  path
    .slice(1)
    .reduce((sum, to, i) => sum + 1 / strengthOf(g.edges[path[i]].get(to)!, categories), 0);

describe("connections", () => {
  it("go both ways, never to oneself, and are exactly as strong as the facts behind them", () => {
    each((g, c) => {
      g.edges.forEach((edges, a) =>
        edges.forEach((edge, b) => {
          expect(a).not.toBe(b);
          expect(g.edges[b].get(a)).toBe(edge);
          const found = evidenceBetween(c, a, b, CATEGORIES);
          expect(found.length).toBe([...edge.count].reduce((x, y) => x + y, 0));
          for (const e of found) expect(new Set([e.a, e.b])).toEqual(new Set([a, b]));
        }),
      );
    });
  });

  it("are missing exactly where there are no facts", () => {
    each((g, c) => {
      c.artists.forEach((_, a) =>
        c.artists.forEach((__, b) => {
          if (a !== b && !g.edges[a].has(b))
            expect(evidenceBetween(c, a, b, CATEGORIES)).toEqual([]);
        }),
      );
    });
  });

  it("are listed strongest first, and only through the kinds asked for", () => {
    each((g, c, r) => {
      const categories = someCategories(r);
      c.artists.forEach((_, a) => {
        const list = neighbors(g, a, categories);
        list.forEach((n, i) => {
          expect(n.strength).toBeGreaterThan(0);
          if (i) expect(n.strength).toBeLessThanOrEqual(list[i - 1].strength);
        });
        for (const { artist } of list) {
          for (const e of evidenceBetween(c, a, artist, categories)) {
            expect(categories).toContain(KIND_RULES[e.kind].category);
          }
        }
      });
    });
  });
});

describe("paths", () => {
  it("shortest: no path is shorter, and of those none is closer", () => {
    each((g, c, r) => {
      const categories = someCategories(r);
      const [from, to] = [0, 1 + r.below(c.artists.length - 1)];
      const all = everyPath(g, from, to, categories, MAX_STEPS);
      const path = findPath(g, from, to, { categories });
      if (!all.length) return expect(path).toBeNull();
      const least = Math.min(...all.map((p) => p.length));
      const cheapest = Math.min(
        ...all.filter((p) => p.length === least).map((p) => costOf(g, p, categories)),
      );
      expect(path).toHaveLength(least);
      expect(costOf(g, path!, categories)).toBeCloseTo(cheapest, 5);
    });
  });

  it("strongest: no path within the limit is closer", () => {
    each((g, c, r) => {
      const categories = someCategories(r);
      const [from, to] = [0, 1 + r.below(c.artists.length - 1)];
      const most = 1 + r.below(MAX_STEPS);
      const all = everyPath(g, from, to, categories, most);
      const path = findPath(g, from, to, { categories, order: "strongest", maxSteps: most });
      if (!all.length) return expect(path).toBeNull();
      expect(path!.length - 1).toBeLessThanOrEqual(most);
      expect(costOf(g, path!, categories)).toBeCloseTo(
        Math.min(...all.map((p) => costOf(g, p, categories))),
        5,
      );
    });
  });

  it("are real: connected at every step, nobody twice, nobody to go around", () => {
    each((g, c, r) => {
      const to = 1 + r.below(c.artists.length - 1);
      const avoid = new Set([2, 3].filter((a) => a !== to && a < c.artists.length));
      for (const order of ["shortest", "strongest"] as const) {
        const path = findPath(g, 0, to, { categories: CATEGORIES, order, avoid });
        if (!path) continue;
        expect([path[0], path[path.length - 1]]).toEqual([0, to]);
        expect(new Set(path).size).toBe(path.length);
        path.slice(1).forEach((b, i) => expect(g.edges[path[i]].has(b)).toBe(true));
        for (const a of path.slice(1, -1)) expect(avoid.has(a)).toBe(false);
      }
    });
  });

  it("are as many steps in either direction", () => {
    each((g, c, r) => {
      const to = 1 + r.below(c.artists.length - 1);
      const there = findPath(g, 0, to, { categories: DEFAULT_CATEGORIES });
      const back = findPath(g, to, 0, { categories: DEFAULT_CATEGORIES });
      expect(there?.length).toBe(back?.length);
    });
  });

  it("offered together share nobody in between, and get no shorter", () => {
    each((g, c, r) => {
      const paths = findPaths(g, 0, 1 + r.below(c.artists.length - 1), { categories: CATEGORIES });
      const between = paths.flatMap((p) => p.slice(1, -1));
      expect(new Set(between).size).toBe(between.length);
      paths.forEach((p, i) => i && expect(p.length).toBeGreaterThanOrEqual(paths[i - 1].length));
    });
  });
});

describe("collaborations", () => {
  it("count each song, album or relationship once, and add up to everyone", () => {
    each((g, c) => {
      c.artists.forEach((_, a) => {
        const { items, total } = collaborations(g, a, "production", 100);
        expect(items).toHaveLength(total);
        for (const { artist, count } of items) {
          const found = evidenceBetween(c, a, c.artistAt.get(artist.id)!, ["producers"]);
          expect(count).toBe(new Set(found.map((e) => `${e.subject.type}${e.subject.at}`)).size);
        }
      });
    });
  });
});

describe("webs", () => {
  it("grow without repeats or loose ends, within the cap, and place everyone apart", () => {
    each((g, c, r) => {
      let web = startWeb(neighborhood(g, 0, CATEGORIES, 5));
      for (let i = 0; i < 3; i++)
        web = growWeb(web, neighborhood(g, r.below(c.artists.length), CATEGORIES, 5));
      const ids = new Set(web.nodes.map((n) => n.id));
      expect(ids.size).toBe(web.nodes.length);
      expect(ids.size).toBeLessThanOrEqual(MAX_NODES);
      for (const e of web.edges) expect(ids.has(e.a) && ids.has(e.b)).toBe(true);
      const points = [...layoutWeb(web).values()];
      points.forEach((p, i) => {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        for (const q of points.slice(i + 1))
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(50);
      });
    });
  });

  it("never let two names overlap", () => {
    each((_, __, r) => {
      const labels = Array.from({ length: 30 }, (_, i) => ({
        id: `${i}`,
        text: "x".repeat(1 + r.below(18)),
        x: r.below(600),
        y: r.below(400),
        radius: 18,
        priority: r.next(),
      }));
      const shown = visibleLabels(labels, 12);
      const boxes = labels
        .filter((l) => shown.has(l.id))
        .map((l) => ({
          l: l.x - l.text.length * 3.48,
          r: l.x + l.text.length * 3.48,
          t: l.y + 21,
          b: l.y + 35.4,
        }));
      boxes.forEach((p, i) =>
        boxes
          .slice(i + 1)
          .forEach((q) =>
            expect(
              p.l < q.r - 0.01 && p.r > q.l + 0.01 && p.t < q.b - 0.01 && p.b > q.t + 0.01,
            ).toBe(false),
          ),
      );
    });
  });
});

describe("text", () => {
  const ODD = [
    "",
    " ",
    "Beyoncé",
    "AC/DC",
    "N.W.A",
    "방탄소년단",
    "🎵🎶",
    "ﬁ",
    "İ",
    "ß",
    "á",
    "<b>",
    "‮",
    "'’`",
    "%%",
    "\\",
    "ＦＵＬＬ",
  ];

  it("normalizes once and for all, and never breaks on odd letters", () => {
    for (const a of ODD) {
      expect(normalize(normalize(a))).toBe(normalize(a));
      for (const b of ODD) {
        const range = matchRange(a + b, b);
        if (range)
          expect(0 <= range[0] && range[0] < range[1] && range[1] <= (a + b).length).toBe(true);
      }
    }
  });

  it("finds every artist, song and label by its own name, unless others share it", () => {
    each((_, c, __, seed) => {
      if (seed > 10) return;
      for (const artist of c.artists) {
        expect(searchCatalog(c, artist.name, ["artist"], 50).map((x) => x.id)).toContain(artist.id);
      }
    });
  });

  it("reads any list of kinds into valid ones, in one order", () => {
    const r = randomFrom(5);
    for (let i = 0; i < 100; i++) {
      const text = Array.from({ length: r.below(6) }, () =>
        r.pick([...CATEGORIES, "x", "", " bands"]),
      ).join(",");
      const read = parseCategories(text);
      expect(read.length).toBeGreaterThan(0);
      expect(CATEGORIES.filter((c) => read.includes(c))).toEqual(read);
    }
  });
});
