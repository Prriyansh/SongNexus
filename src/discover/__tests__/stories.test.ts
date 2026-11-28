// Stories: each kind found where the credits say so, and only there.
import { describe, expect, it } from "vitest";
import { evidenceBetween } from "../lib/graph";
import { graph } from "../lib/server";
import {
  findStories,
  MAX_PER_KIND,
  stories,
  storyNumber,
  storyOfDay,
  type StoryKind,
} from "../lib/stories";
import { storyHref } from "../lib/links";
import { shuffled } from "../lib/random";
import { reasonOf } from "../lib/words";
import { songsBy, world, type WorldSpec } from "./world";

const found = (spec: WorldSpec, kind: StoryKind) =>
  findStories(world(spec)).filter((story) => story.kind === kind);
const names = (spec: WorldSpec, kind: StoryKind) =>
  found(spec, kind)
    .map((story) => story.artists.map((a) => a.name).join(" + "))
    .sort();

describe("one producer, two worlds", () => {
  const base: WorldSpec = {
    artists: ["A", "B", "C", "P"],
    others: ["Z"],
    songs: [
      ["a1", 2000, [["A", "primary"], ["P", "producer"]]],
      ["b1", 2001, [["B", "primary"], ["P", "producer"]]],
      ["own", 2002, [["P", "primary"], ["P", "producer"]]],
      ["z1", 2003, [["Z", "primary"], ["P", "producer"]]],
      ["guest", 2004, [["Z", "primary"], ["C", "featured"], ["P", "producer"]]],
    ],
    releases: [["A’s album", 1999, ["A"], [["P", "producer"]]]],
  };

  it("tells of two well-known artists with no credit together who share a producer", () => {
    const [story] = found(base, "shared-producer");
    expect(story.text).toBe("No credit links A and B in this catalog, but P produced for both.");
    expect(story.artists.map((a) => a.name)).toEqual(["A", "B", "P"]);
    expect(story.pair!.map((a) => a.name)).toEqual(["A", "B"]);
    // Each one's oldest credit first, then the rest.
    expect(story.reasons.map((r) => r.text)).toEqual([
      "P produced the album “A’s album” by A",
      "P produced “b1” by B",
      "P produced “a1” by A",
    ]);
    // A guest spot (C on "guest") is not C's own song, and Z isn't well known.
    expect(names(base, "shared-producer")).toEqual(["A + B + P"]);
  });

  it("skips pairs with a credit together, and producers in either one's band", () => {
    const together = { ...base, songs: [...base.songs!, ["duet", 2005, [["A", "primary"], ["B", "primary"]]]] };
    const withC = (spec: WorldSpec): WorldSpec => ({
      ...spec,
      songs: [...spec.songs!, ["c1", 2006, [["C", "primary"], ["P", "producer"]]]],
    });
    expect(names(withC(together as WorldSpec), "shared-producer")).toEqual(["A + C + P"]);
    const inA = withC({ ...base, relations: [["P", "member_of", "A"]] });
    expect(names(inA, "shared-producer")).toEqual(["B + C + P"]);
    const inB = withC({ ...base, relations: [["P", "member_of", "B"]] });
    expect(names(inB, "shared-producer")).toEqual(["A + C + P"]);
  });
});

describe("two steps apart", () => {
  const spec: WorldSpec = {
    artists: ["A", "B", "V1", "V2", "V3", "Lone"],
    others: ["N"],
    songs: [
      ["an", 2000, [["A", "primary"], ["N", "featured"]]],
      ["a3", 2001, [["A", "primary"], ["V3", "featured"]]],
      ["b3", 2002, [["B", "primary"], ["V3", "featured"]]],
      ["a1", 2003, [["A", "primary"], ["V1", "featured"]]],
      ["b1", 2004, [["B", "primary"], ["V1", "featured"]]],
      ["a2", 2005, [["A", "primary"], ["V2", "featured"]]],
      ["b2", 2006, [["B", "primary"], ["V2", "featured"]]],
    ],
    genres: { A: [[0, 80], [1, 20]], B: [[0, 50]] },
  };

  it("names the closest person between two artists, the first in the catalog on a tie", () => {
    const story = found(spec, "two-steps").find((s) => s.artists[0].name === "A")!;
    expect(story.text).toBe("No credit links A and B in this catalog, but both worked with V1.");
    expect(story.reasons.map((r) => r.text)).toEqual([
      "V1 is featured on “a1” by A",
      "V1 is featured on “b1” by B",
    ]);
  });

  it("leaves out artists already linked, and those with no one in common", () => {
    const all = names(spec, "two-steps");
    expect(all).not.toContain("A + V1 + B");
    expect(all.some((n) => n.includes("Lone"))).toBe(false);
  });
});

describe("the musician behind the songs", () => {
  const spec: WorldSpec = {
    artists: ["S1", "S2", "M", "M2", "M3", "BM", "R", "Few"],
    songs: [
      ...songsBy("S1", 5, "M", "instrument", "guitar"),
      ...songsBy("S1", 1, "M", "instrument", "piano", 2010),
      ...songsBy("S1", 7, "M2", "vocal"),
      ...songsBy("S1", 5, "M3", "instrument", "drums"),
      ...songsBy("S1", 6, "BM", "instrument", "bass"),
      ...songsBy("S1", 2, "R", "instrument", "organ"),
      ...songsBy("S2", 2, "Few", "instrument", "harp"),
    ],
    releases: Array.from({ length: 4 }, (_, i) => [`S1 album ${i}`, 2000 + i, ["S1"], [["R", "instrument", "organ"]]]),
    relations: [["BM", "member_of", "S1"]],
  };

  it("names whoever is credited on the most of an artist's songs, and their usual part", () => {
    const [story] = found(spec, "session-player");
    expect(story.text).toBe("M2 is credited with vocals on 7 of S1’s songs in this catalog.");
    expect(story.pair).toBeNull();
    expect(story.reasons).toHaveLength(7);
  });

  it("keeps the part credited most often", () => {
    const fewer = { ...spec, songs: spec.songs!.filter(([, , credits]) => credits[1][0] !== "M2") };
    expect(found(fewer, "session-player")[0].text).toBe(
      "M is credited with guitar on 6 of S1’s songs in this catalog.",
    );
  });

  it("leaves out band members, album-only credits and artists with no regular player", () => {
    const only = (spec.songs ?? []).filter(([, , credits]) => ["BM", "R"].includes(credits[1][0]));
    expect(found({ ...spec, songs: only }, "session-player")).toEqual([]);
  });
});

describe("label mates", () => {
  const spec: WorldSpec = {
    artists: ["A", "B", "C", "D", "E"],
    songs: [["ac", 2000, [["A", "primary"], ["C", "featured"]]]],
    releases: ["A", "B", "C", "D"].map((who, i) => [`${who} album`, 2000 + i, [who], [], 0]),
  };

  it("tells of well-known artists linked only by a label, one story per lead artist", () => {
    const all = found(spec, "label-mates");
    expect(all.map((s) => s.artists.map((a) => a.name).join(" + ")).sort()).toEqual(["A + B", "B + C", "C + D"]);
    expect(all.find((s) => s.artists[0].name === "A")!.text).toBe(
      "Only a label links A and B in this catalog: both released albums on One Label within three years of each other.",
    );
  });
});

describe("samples", () => {
  const spec: WorldSpec = {
    artists: ["A", "B", "C"],
    others: ["S", "T", "U", "U2"],
    songs: [
      ["s1", 1990, [["A", "primary"], ["S", "sampled"]]],
      ["s1 again", 1990, [["A", "primary"], ["S", "sampled"]]],
      ["s2", 1995, [["C", "featured"], ["A", "primary"], ["S", "sampled"]]],
      ["s3", 2003, [["B", "primary"], ["S", "sampled"]]],
      ["s0", null, [["C", "primary"], ["S", "sampled"]]],
      ["undated", null, [["B", "primary"], ["S", "sampled"]]],
      ["self", 2000, [["A", "primary"], ["A", "sampled"]]],
      ["obscure", 2000, [["T", "primary"], ["U", "sampled"]]],
      ["one", 2010, [["T", "primary"], ["B", "sampled"]]],
      ["two", 2011, [["C", "primary"], ["U2", "sampled"]]],
    ],
  };

  it("tells of one sample used years apart by two artists", () => {
    const [story] = found(spec, "same-sample");
    expect(story.text).toBe("A sampled S in 1990; 13 years later, B did too.");
    expect(story.pair!.map((a) => a.name)).toEqual(["A", "B"]);
    expect(story.reasons.map((r) => r.text)).toEqual(["“s1” by A samples S", "“s3” by B samples S"]);
  });

  it("tells of a single sample otherwise, and only about the well known", () => {
    expect(found(spec, "sampled").map((s) => s.text).sort()).toEqual([
      "“one” by T samples B.",
      "“two” by C samples U2.",
    ]);
  });

  it("needs two different artists far enough apart for the longer story", () => {
    const close = { ...spec, songs: spec.songs!.filter(([title]) => title !== "s3") };
    expect(found(close, "same-sample")).toEqual([]);
    expect(found(close, "sampled").map((s) => s.text)).toContain("“s1” by A samples S.");
  });
});

describe("the feed", () => {
  const g = graph();

  it("mixes the kinds, at most a fixed number of each, the same every time", () => {
    const all = findStories(g);
    const counts = new Map<string, number>();
    all.forEach((s) => counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1));
    expect(counts.size).toBeGreaterThanOrEqual(4);
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(MAX_PER_KIND);
    expect(new Set(all.slice(0, counts.size).map((s) => s.kind)).size).toBe(counts.size);
    expect(findStories(g).map((s) => s.id)).toEqual(all.map((s) => s.id));
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  });

  it("backs every story with credits and never says two artists aren't connected", () => {
    for (const story of stories(g)) {
      expect(story.reasons.length).toBeGreaterThan(0);
      expect(story.text).not.toMatch(/never|not connected|aren’t connected/);
      expect(new Set(story.artists.map((a) => a.id)).size).toBe(story.artists.length);
    }
    expect(stories(g)).toBe(stories(g));
  });

  it("gives every day a story, in turn", () => {
    const all = stories(g);
    expect(storyOfDay(all, 0)).toBe(0);
    expect(storyOfDay(all, all.length + 2)).toBe(2);
    expect(storyOfDay(all, -1)).toBe(all.length - 1);
  });

  it("reads a story number from an address", () => {
    expect(storyNumber("3", 10)).toBe(3);
    expect(storyNumber("10", 10)).toBe(10);
    for (const bad of ["", "0", "11", "2.5", "x"]) expect(storyNumber(bad, 10)).toBe(1);
    expect(storyHref(4)).toBe("/discover/stories?story=4");
  });

  it("shuffles the same way for the same seed", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffled(items, 7)).toEqual(shuffled(items, 7));
    expect(shuffled(items, 7)).not.toEqual(items);
    expect([...shuffled(items, 7)].sort((x, y) => x - y)).toEqual(items);
  });
});

describe("sentences about a featured guest", () => {
  const g = world({
    artists: ["A", "B", "P", "M", "E", "S"],
    songs: [
      [
        "Song",
        2000,
        [
          ["A", "primary"],
          ["B", "featured"],
          ["P", "producer"],
          ["M", "instrument", "guitar"],
          ["E", "engineer"],
          ["S", "sampled"],
        ],
      ],
    ],
  });
  const c = g.catalog;
  const said = (x: number, kind: string) =>
    evidenceBetween(c, x, 1, ["producers", "contributions", "samples", "engineering"])
      .filter((e) => e.kind === kind)
      .map((e) => reasonOf(c, e).text);

  it("say the song features them rather than that it is theirs", () => {
    expect(said(2, "produced_for")).toEqual(["P produced “Song” (featuring B)"]);
    expect(said(3, "contributed_to")).toEqual(["M is credited with guitar on “Song” (featuring B)"]);
    expect(said(4, "engineered")).toEqual(["E engineered “Song” (featuring B)"]);
    expect(said(5, "sampled")).toEqual(["“Song” (featuring B) samples S"]);
  });
});
