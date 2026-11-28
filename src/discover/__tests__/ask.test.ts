// Ask: reading questions, and answering each kind from the credits.
import { describe, expect, it } from "vitest";
import { ask, cleanQuestion, nameOf, parseQuestion, type Answer } from "../lib/ask";
import { askHref, EXAMPLE_QUESTIONS, looksLikeQuestion } from "../lib/question";
import { graph } from "../lib/server";
import { world } from "./world";

describe("reading a question", () => {
  it("drops greetings, curly quotes and closing punctuation", () => {
    expect(cleanQuestion("  Hey, can you tell me who produced “Umbrella”?!  ")).toBe('who produced "Umbrella"');
    expect(cleanQuestion("ok so tell me:  who   sang ‘Hello’...")).toBe("who sang 'Hello'");
  });

  it("takes names as written, without the words around them", () => {
    expect(nameOf(' "Umbrella" ')).toBe("Umbrella");
    expect(nameOf("the song Halo")).toBe("Halo");
    expect(nameOf("rapper Drake together")).toBe("Drake");
    expect(nameOf("Rihanna's")).toBe("Rihanna");
  });

  it.each([
    ["How is Johnny Cash connected to Rihanna?", { intent: "path", a: "Johnny Cash", b: "Rihanna", strongest: false }],
    ["Taylor Swift -> Drake", { intent: "path", a: "Taylor Swift", b: "Drake", strongest: false }],
    ["the strongest path between Adele and Drake", { intent: "path", a: "Adele", b: "Drake", strongest: true }],
    ["how are Adele and Drake linked", { intent: "path", a: "Adele", b: "Drake", strongest: false }],
    ["is Adele connected to Drake", { intent: "path" }],
    ["are Adele and Drake related", { intent: "path" }],
    ["six degrees of Adele to Drake", { intent: "path" }],
    ["how many steps between Adele and Drake", { intent: "path" }],
    ["how far is Adele from Drake", { intent: "path" }],
    ["how close are Adele and Drake", { intent: "path" }],
    ["did Adele ever work with Drake", { intent: "path", a: "Adele", b: "Drake" }],
    ["have Adele and Drake ever collaborated", { intent: "path" }],
    ["connect Adele and Drake", { intent: "path" }],
    ["from Adele to Drake", { intent: "path" }],
    ["compare Adele and Drake", { intent: "compare", a: "Adele", b: "Drake" }],
    ["what's the overlap between Adele and Drake", { intent: "compare" }],
    ["What do Adele and Ed Sheeran have in common?", { intent: "compare", a: "Adele", b: "Ed Sheeran" }],
    ["how does Adele compare to Drake", { intent: "compare" }],
    ["Adele vs Drake", { intent: "compare" }],
    ["Artists like Bon Iver", { intent: "connections", artist: "Bon Iver" }],
    ["which bands are similar to Bon Iver", { intent: "connections" }],
    ["what should i listen to if i like Bon Iver", { intent: "connections" }],
    ["fans of Bon Iver", { intent: "connections" }],
    ["Who produced Umbrella?", { intent: "credits", song: "Umbrella", role: "producer" }],
    ["who are the producers of Umbrella", { intent: "credits", role: "producer" }],
    ["who is featured on Monster", { intent: "credits", song: "Monster", role: "featured" }],
    ["who raps on Monster", { intent: "credits", role: "featured" }],
    ["features on Monster", { intent: "credits", role: "featured" }],
    ["who sang Hello", { intent: "credits", role: "performer" }],
    ["full credits for Hello", { intent: "credits", role: "all" }],
    ["who played on Hello", { intent: "credits", role: "all" }],
    ["Hello song credits", { intent: "credits", song: "Hello", role: "all" }],
    ["who produced for Beyoncé", { intent: "collaborators", artist: "Beyoncé", type: "production", direction: "produced by them" }],
    ["who did Pharrell produce for", { intent: "collaborators", artist: "Pharrell", type: "production", direction: "produced for them" }],
    ["who has Drake featured on songs", { intent: "collaborators", artist: "Drake", type: "features", direction: null }],
    ["Who has Taylor Swift worked with the most?", { intent: "collaborators", artist: "Taylor Swift", type: null }],
    ["who has worked with Adele", { intent: "collaborators", artist: "Adele", type: null }],
    ["Which bands was Dave Grohl in?", { intent: "collaborators", artist: "Dave Grohl", type: "bands" }],
    ["Adele's collaborators", { intent: "collaborators", artist: "Adele", type: null }],
    ["Adele's features", { intent: "collaborators", type: "features" }],
    ["Drake's producers", { intent: "collaborators", type: "production", direction: "produced by them" }],
    ["Who sampled Chimamanda Ngozi Adichie?", { intent: "sampled", artist: "Chimamanda Ngozi Adichie" }],
    ["Kendrick Lamar", { intent: "lookup", text: "Kendrick Lamar" }],
    ["what is the meaning of life", { intent: "unknown" }],
    ["one two three four five six seven", { intent: "unknown" }],
    ["?!", { intent: "unknown" }],
  ])("reads %j", (question, expected) => {
    expect(parseQuestion(question)).toMatchObject(expected);
  });

  it("tells a question from a name in the search box", () => {
    expect(looksLikeQuestion("who produced Umbrella")).toBe(true);
    expect(looksLikeQuestion("Adele -> Drake")).toBe(true);
    expect(looksLikeQuestion("Adele vs Drake")).toBe(true);
    expect(looksLikeQuestion("this is it?")).toBe(true);
    expect(looksLikeQuestion("who")).toBe(false);
    expect(looksLikeQuestion("The Rolling Stones")).toBe(false);
    expect(askHref(" who sang Hello ")).toBe("/discover/ask?q=who%20sang%20Hello");
  });
});

describe("answers", () => {
  const g = world({
    artists: ["Anna", "Ben", "Cara", "Dev", "Eve", "Lone"],
    others: ["Pro", "Dora"],
    songs: [
      ["Alpha", 2001, [["Anna", "primary"], ["Ben", "featured"], ["Pro", "producer"], ["Cara", "instrument", "guitar"]]],
      ["Beta", 2002, [["Ben", "primary"], ["Pro", "producer"], ["Anna", "producer"]]],
      ["Gamma", 2003, [["Dev", "primary"], ["Anna", "sampled"]]],
      ["Delta", null, [["Cara", "primary"], ["Anna", "sampled"]]],
      ["Iota", null, [["Eve", "primary"], ["Anna", "sampled"]]],
      ["Alpha", 1999, [["Eve", "primary"]]],
      ["Stand by Me", 1961, [["Dev", "primary"], ["Pro", "producer"]]],
      ["Echo", 2004, [["Dev", "primary"], ["Pro", "producer"], ["Pro", "instrument", "piano"]]],
      ["Zeta", 2006, [["Ben", "primary"], ["Cara", "instrument", "guitar"]]],
      ["Eta", 2007, [["Anna", "primary"], ["Dora", "instrument", "drums"]]],
      ["Theta", 2008, [["Ben", "primary"], ["Dora", "instrument", "drums"]]],
    ],
    releases: [
      ["Anna’s Album", 2001, ["Anna"], [], 0],
      ["Ben’s Album", 2002, ["Ben"], [], 0],
      ["Dev’s Album", 2005, ["Dev"], [["Anna", "producer"]], 1],
    ],
    relations: [["Anna", "member_of", "Eve"]],
    genres: { Anna: [[0, 60], [1, 40]], Ben: [[0, 100]] },
  });
  const answer = <K extends Answer["kind"]>(question: string, kind: K) => {
    const found = ask(g, question);
    expect(found.kind).toBe(kind);
    return found as Extract<Answer, { kind: K }>;
  };
  const names = (list: { name: string }[]) => list.map((x) => x.name);

  it("finds the path between two artists, or says why not", () => {
    const found = answer("how is Anna connected to Dev", "path");
    expect(found.reading).toBe("How Anna is connected to Dev");
    expect(found.result.status).toBe("ok");
    expect(found.href).toContain("/discover/six-degrees?from=");
    expect(answer("strongest path between Anna and Dev", "path").reading).toBe(
      "How Anna is connected to Dev, through the closest working relationships",
    );
    expect(answer("Anna -> Anna", "path").result.status).toBe("same-artist");
    expect(answer("Anna -> Lone", "path").result.status).toBe("not-connected");
    expect(answer("Anna -> Nobody", "missing")).toMatchObject({ names: ["Nobody"], what: "artist" });
    expect(answer("Someone -> Nobody", "missing").names).toEqual(["Someone", "Nobody"]);
  });

  it("says what two artists have in common", () => {
    const found = answer("what do Anna and Ben have in common", "compare");
    expect(found.linked.map((r) => r.text)).toContain("Ben is featured on “Alpha” by Anna");
    expect(found.linkedTotal).toBeGreaterThan(1);
    // The closest shared people first; on a tie, the first in the catalog.
    expect(names(found.shared)).toEqual(["Pro", "Cara", "Dora"]);
    expect(found.sharedTotal).toBe(3);
    expect(names(found.genres)).toEqual(["pop"]);
    expect(names(found.labels)).toEqual(["One Label"]);
    expect(found.exploreHref).toBe(`/compare/artists?artistA=${found.a.id}&artistB=${found.b.id}`);
    expect(found.pathHref).toContain("/discover/six-degrees?from=");
  });

  it("compares two songs by who is credited on both", () => {
    const found = answer("compare Echo and Stand by Me", "compare-songs");
    expect(found.shared.map((p) => p.artist.name)).toEqual(["Dev", "Pro"]);
    expect(found.exploreHref).toBe(`/compare/songs?songA=${found.a.id}&songB=${found.b.id}`);
  });

  it("compares only like with like, and names what it can't find", () => {
    expect(answer("compare Anna and Echo", "missing")).toMatchObject({ names: ["Echo"], what: "artist" });
    expect(answer("compare Nobody and Echo", "missing")).toMatchObject({ names: ["Nobody"], what: "artist or song" });
  });

  it("lists a song's credits, by role", () => {
    const producers = answer("who produced Alpha by Anna", "credits");
    expect(producers.groups.map((g) => [g.title, g.people.map((p) => p.artist.name)])).toEqual([["Producers", ["Pro"]]]);
    expect(producers.reading).toBe("Who produced “Alpha”");
    const featured = answer("who is featured on Alpha by Anna", "credits");
    expect(featured.groups.flatMap((g) => g.people.map((p) => p.artist.name))).toEqual(["Ben"]);
    const performer = answer("who sang Anna's Alpha", "credits");
    expect(performer.groups.flatMap((g) => g.people.map((p) => p.artist.name))).toEqual(["Anna"]);
    const all = answer("credits for Alpha by Anna", "credits");
    expect(all.groups.map((g) => g.title)).toEqual(["Performers", "Producers", "Vocals and instruments"]);
    expect(answer("who produced Alpha by Eve", "credits").groups).toEqual([]);
  });

  it("finds a song whose title has “by” in it", () => {
    expect(answer("who produced Stand by Me", "credits").song.name).toBe("Stand by Me");
  });

  it("answers a song question about an artist as one about their collaborators", () => {
    expect(answer("who produced Lone", "collaborators")).toMatchObject({ reading: "Who produced for Lone", items: [], total: 0 });
    expect(answer("who produced Nothing", "missing")).toMatchObject({ names: ["Nothing"], what: "song" });
  });

  it("lists who an artist worked with, of each kind", () => {
    const most = answer("who has Anna worked with the most", "collaborators");
    expect(most.reading).toBe("Who Anna worked with most");
    expect(names(most.items.map((i) => i.artist))).toContain("Ben");
    expect(most.href).toContain("via=");
    expect(names(answer("who produced for Ben", "collaborators").items.map((i) => i.artist)).sort()).toEqual(["Anna", "Pro"]);
    const produced = answer("who did Anna produce for", "collaborators");
    expect(produced.reading).toBe("Who Anna produced for");
    expect(names(produced.items.map((i) => i.artist)).sort()).toEqual(["Ben", "Dev"]);
    expect(answer("Anna's features", "collaborators").reading).toBe("Who Anna performed with");
    const bands = answer("which bands was Anna in", "collaborators");
    expect([bands.reading, names(bands.items.map((i) => i.artist))]).toEqual(["The bands and projects Anna is part of", ["Eve"]]);
    expect(bands.href).not.toContain("via=");
    expect(answer("who has Nobody worked with", "missing").names).toEqual(["Nobody"]);
  });

  it("lists who sampled an artist, oldest first", () => {
    expect(answer("who sampled Anna", "sampled").reasons.map((r) => r.text)).toEqual([
      "“Gamma” by Dev samples Anna",
      "“Delta” by Cara samples Anna",
      "“Iota” by Eve samples Anna",
    ]);
    expect(answer("who sampled Ben", "sampled").total).toBe(0);
    expect(answer("who sampled Nobody", "missing").names).toEqual(["Nobody"]);
  });

  it("lists an artist's connections", () => {
    const found = answer("artists like Anna", "connections");
    expect(found.total).toBeGreaterThan(0);
    expect(found.href).toBe(`/discover/connections?artist=${found.artist.id}`);
    expect(answer("explore Lone", "connections").items).toEqual([]);
    expect(answer("fans of Nobody", "missing").names).toEqual(["Nobody"]);
  });

  it("looks up a name, and says when it can't answer", () => {
    expect(names(answer("Anna", "lookup").results)).toContain("Anna");
    expect(answer("zzzz", "lookup").results).toEqual([]);
    expect(ask(g, "what is the meaning of life")).toEqual({ kind: "unknown" });
  });
});

describe("the example questions", () => {
  it("each get a real answer from the committed catalog", () => {
    for (const question of EXAMPLE_QUESTIONS) {
      const found = ask(graph(), question) as { kind: string; items?: unknown[]; reasons?: unknown[]; groups?: unknown[] };
      expect(found.kind, question).not.toMatch(/unknown|missing|lookup/);
      for (const list of [found.items, found.reasons, found.groups]) if (list) expect(list.length, question).toBeGreaterThan(0);
    }
  });
});
