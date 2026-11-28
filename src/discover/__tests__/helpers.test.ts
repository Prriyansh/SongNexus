import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { photoAt, photoSources } from "../lib/images";
import {
  ease,
  mixPoints,
  mixViews,
  nextInDirection,
  visibleLabels,
  type Label,
  type Point,
} from "../lib/layout";
import { matchRange } from "../lib/match";
import { pageMetadata } from "../lib/metadata";
import { playlistOf, playlistText } from "../lib/playlist";
import { artistsIn, oneOf } from "../lib/query";
import type { EntityRef, FoundPath } from "../lib/types";

describe("photos", () => {
  const url = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Anna.jpg/330px-Anna.jpg";

  it("come at a size Commons keeps ready, never larger than the one we know exists", () => {
    expect(photoAt(url, 44)).toContain("/120px-Anna.jpg");
    expect(photoAt(url, 130)).toContain("/250px-Anna.jpg");
    expect(photoAt(url, 2000)).toContain("/330px-Anna.jpg");
    expect(photoSources(url, 100).srcSet).toMatch(/120px-Anna\.jpg 1x, .*250px-Anna\.jpg 2x/);
  });

  it("too small to have scaled versions stay as they are", () => {
    const original = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Tiny.jpg";
    expect(photoAt(original, 44)).toBe(original);
  });
});

describe("marking what matched", () => {
  const marked = (text: string, query: string) => {
    const range = matchRange(text, query);
    return range && text.slice(...range);
  };

  it("ignores case and accents, and only marks the start of a word", () => {
    expect(marked("Beyoncé", "BEYONCE")).toBe("Beyoncé");
    expect(marked("Sigur Rós", "ro")).toBe("Ró");
    expect(marked("Foreigner", "eig")).toBeNull();
    expect(marked("The Eve Band", "eve")).toBe("Eve");
  });

  it("copes with letters that fold into several, and with nothing to find", () => {
    expect(marked("ﬁne day", "fi")).toBe("ﬁ");
    expect(marked("방탄소년단", "방탄")).toBe("방탄");
    expect(marked("Anna", "  ")).toBeNull();
  });
});

describe("the web’s geometry", () => {
  const label = (id: string, x: number, priority: number, always = false): Label => ({
    id,
    text: "A long enough name",
    x,
    y: 0,
    radius: 20,
    priority,
    always,
  });

  it("shows names that fit, the most important first", () => {
    expect([...visibleLabels([label("a", 0, 1), label("b", 400, 0)], 12)]).toEqual(["a", "b"]);
    expect([...visibleLabels([label("a", 0, 1), label("b", 30, 2)], 12)]).toEqual(["b"]);
  });

  it("never hides the name being looked at, and keeps the others off faces", () => {
    expect(visibleLabels([label("a", 0, 1, true), label("b", 30, 2)], 12).has("a")).toBe(true);
    const below: Label = { ...label("face", 0, 5), y: 34, text: "x" };
    expect(visibleLabels([label("a", 0, 1), below], 12).has("a")).toBe(false);
  });

  it("moves by arrow keys to what lies that way", () => {
    const points = new Map<string, Point>([
      ["middle", { x: 0, y: 0 }],
      ["right", { x: 100, y: 10 }],
      ["corner", { x: 40, y: 60 }],
      ["left", { x: -50, y: 0 }],
    ]);
    expect(nextInDirection(points, "middle", [1, 0])).toBe("right");
    expect(nextInDirection(points, "middle", [0, 1])).toBe("corner");
    expect(nextInDirection(points, "middle", [0, -1])).toBeNull();
    expect(nextInDirection(points, "gone", [1, 0])).toBeNull();
  });

  it("glides from one layout to the next, with newcomers coming out of one place", () => {
    const from = new Map([["a", { x: 0, y: 0 }]]);
    const to = new Map([
      ["a", { x: 10, y: 20 }],
      ["new", { x: 100, y: 100 }],
    ]);
    const half = mixPoints(from, to, 0.5, { x: 50, y: 50 });
    expect(half.get("a")).toEqual({ x: 5, y: 10 });
    expect(half.get("new")).toEqual({ x: 75, y: 75 });
    const view = { x: 0, y: 0, width: 100, height: 50 };
    expect(mixViews(view, { ...view, width: 200 }, 0.5).width).toBe(150);
    expect([ease(0), ease(0.5), ease(1)]).toEqual([0, 0.5, 1]);
  });
});

describe("a path as a playlist", () => {
  const song = (id: string): EntityRef => ({ kind: "song", id, name: `Song ${id}`, note: "Anna" });
  const label: EntityRef = { kind: "label", id: "l", name: "Label", note: "" };
  const step = (...subjects: (EntityRef | null)[]) => ({
    reasons: subjects.map((subject) => ({ category: "features", text: "", subject, year: null })),
  });
  const path = {
    artists: [],
    steps: [step(song("1")), step(null, label), step(song("1"), song("2"))],
  } as unknown as FoundPath;

  it("takes one new song from each step that has one", () => {
    expect(playlistOf(path).map((s) => s.id)).toEqual(["1", "2"]);
    expect(playlistText(playlistOf(path))).toBe("Anna - Song 1\nAnna - Song 2");
  });
});

describe("reading addresses", () => {
  const artistAt = new Map([
    ["a", 1],
    ["b", 2],
  ]);

  it("takes the first of a repeated parameter, and leaves out unknown artists and repeats", () => {
    expect(oneOf({ q: ["x", "y"] }, "q")).toBe("x");
    expect(oneOf({}, "q")).toBe("");
    expect(artistsIn({ open: "A,nope,b,a" }, "open", artistAt, 5)).toEqual([1, 2]);
    expect(artistsIn({ open: "a,b" }, "open", artistAt, 1)).toEqual([1]);
    expect(artistsIn({}, "open", artistAt, 5)).toEqual([]);
  });
});

it("pages describe themselves to search engines and link previews", () => {
  const meta = pageMetadata("ABBA", "Swedish pop quartet", "/discover/artist/x", "https://x/y.jpg");
  expect(meta.title).toBe("ABBA · Song Nexus");
  expect(meta.alternates?.canonical).toBe("/discover/artist/x");
  expect(meta.openGraph).toMatchObject({ title: meta.title, images: [{ url: "https://x/y.jpg" }] });
});

describe("what reaches the browser", () => {
  const root = path.resolve("src/discover");
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !f.includes("__tests__"))
    .map((f) => path.join(root, f));
  const importsOf = (file: string) =>
    [...readFileSync(file, "utf8").matchAll(/^import (?!type)[^;]*? from "(\.[^"]+)"/gm)]
      // An import of types alone disappears when the file is built.
      .filter(([whole]) => !/^import \{\s*(type [^,}]+,?\s*)+\} from/.test(whole))
      .map(([, to]) => path.resolve(path.dirname(file), to))
      .map((to) => files.find((f) => f === `${to}.ts` || f === `${to}.tsx`)!)
      .filter(Boolean);

  it("never includes the catalog, the graph or anything that reads files", () => {
    const clients = files.filter((f) => readFileSync(f, "utf8").startsWith('"use client"'));
    expect(clients.length).toBeGreaterThan(6);
    const reached = new Set<string>();
    const visit = (file: string) => {
      if (reached.has(file)) return;
      reached.add(file);
      importsOf(file).forEach(visit);
    };
    clients.forEach(visit);
    const names = [...reached].map((f) => path.basename(f));
    for (const server of ["catalog.ts", "graph.ts", "server.ts", "search.ts", "words.ts"]) {
      expect(names).not.toContain(server);
    }
    for (const file of reached) expect(readFileSync(file, "utf8")).not.toContain('from "node:');
  });
});
