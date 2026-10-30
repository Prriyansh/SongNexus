import { describe, expect, it } from "vitest";
import { buildTasteMap, parseMember, parseTasteRequest, shelfOf } from "../taste";
import type { SimilarRow } from "../taste";

const songs = (...rows: [string, string][]) => rows.map(([title, artist]) => ({ title, artist }));
const row = (name: string): SimilarRow => ({ name, mbid: `mbid-${name}` });
const key = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const similar = (entries: Record<string, string[]>) => new Map(Object.entries(entries).map(([k, names]) => [key(k), names.map(row)]));
const mine = shelfOf(songs(["vampire", "Olivia Rodrigo"], ["Kill Bill", "SZA"], ["Royals", "Lorde"]));
const theirs = shelfOf(songs(["HUMBLE.", "Kendrick Lamar"], ["Kill Bill", "SZA"], ["Snooze", "SZA"], ["Obscure", "Quiet One"]));
const build = (sim = {}) => buildTasteMap(mine, theirs, similar(sim), new Map(), "Sam");
const node = (map: ReturnType<typeof build>, name: string) => map.nodes.find((n) => n.name === name)!;

describe("buildTasteMap with a friend", () => {
  it("finds shared artists and songs, whatever the formatting", () => {
    const map = buildTasteMap(shelfOf(songs(["Kill Bill (feat. Doja Cat)", "SZA"])), shelfOf(songs(["KILL BILL", "sza"])), new Map(), new Map(), "Sam");
    expect(map.stats).toMatchObject({ sharedArtists: 1, sharedSongs: 1 });
    expect(map.nodes.map((n) => n.group)).toEqual(["shared", "shared"]);
  });
  it("keeps what isn't connected as simply yours or theirs", () => {
    const map = build();
    expect(node(map, "Olivia Rodrigo").group).toBe("mine");
    expect(node(map, "Kendrick Lamar").group).toBe("theirs");
    expect(node(map, "SZA").group).toBe("shared");
  });
  it("says who should listen to what, and why, from the listening data only", () => {
    const map = build({ Lorde: ["Kendrick Lamar"], "Kendrick Lamar": ["Olivia Rodrigo"] });
    const kendrick = node(map, "Kendrick Lamar");
    expect(kendrick.group).toBe("for-me");
    expect(kendrick.reasons.at(-1)?.text).toContain("Lorde, on your playlist, often play Kendrick Lamar");
    const olivia = node(map, "Olivia Rodrigo");
    expect(olivia.group).toBe("for-them");
    expect(olivia.reasons.at(-1)?.text).toContain("Sam might like this");
    expect(node(map, "Quiet One").group).toBe("theirs");
  });
  it("flags a recommended artist's songs too", () => {
    const map = build({ Lorde: ["Kendrick Lamar"] });
    expect(node(map, "HUMBLE.").group).toBe("for-me");
    expect(node(map, "HUMBLE.").reasons.at(-1)?.text).toContain("You might like this");
  });
  it("draws lines for playlist songs and similar artists", () => {
    const map = build({ Lorde: ["Kendrick Lamar"] });
    expect(map.links).toContainEqual(expect.objectContaining({ kind: "similar" }));
    expect(map.links.filter((l) => l.kind === "contains").length).toBeGreaterThan(0);
    expect(map.stats.similarLinks).toBe(1);
  });
  it("suggests artists new to both, preferring those connected to both of you, and names them", () => {
    const map = build({ Lorde: ["Both Sides", "Only Mine"], "Kendrick Lamar": ["Both Sides"] });
    const added = map.nodes.filter((n) => n.group === "new");
    expect(added.map((n) => n.name)).toEqual(["Both Sides", "Only Mine"]);
    expect(added[0].reasons[0].text).toContain("New to both of you: people who play Lorde (yours) and Kendrick Lamar (Sam’s)");
    expect(added[0].mbid).toBe("mbid-Both Sides");
  });
  it("never suggests something already on a playlist", () => {
    const map = build({ Lorde: ["SZA", "Kendrick Lamar"] });
    expect(map.nodes.filter((n) => n.group === "new")).toEqual([]);
  });
});

describe("buildTasteMap alone", () => {
  it("shows your music and what's new, with no friend's groups", () => {
    const map = buildTasteMap(mine, null, similar({ Lorde: ["New Person"] }), new Map());
    const groups = new Set(map.nodes.map((n) => n.group));
    expect(groups).toEqual(new Set(["mine", "new"]));
    expect(node(map as never, "New Person").reasons[0].text).toBe("New to you: people who play Lorde often play New Person too.");
  });
});

describe("request validation", () => {
  it("cleans a valid request, dropping rows without an artist", () => {
    expect(parseTasteRequest({ mine: [{ title: " A ", artist: " B " }, { title: "No artist" }], friendName: "  Sam  " })).toEqual({ mine: [{ title: "A", artist: "B" }], friendName: "Sam" });
  });
  it("rejects nothing to map, too many songs, and junk", () => {
    expect(parseTasteRequest(null)).toBeNull();
    expect(parseTasteRequest({ mine: [] })).toBeNull();
    expect(parseTasteRequest({ mine: "x" })).toBeNull();
    expect(parseTasteRequest({ mine: Array(251).fill({ title: "a", artist: "b" }) })).toBeNull();
    expect(parseTasteRequest({ mine: [{ title: "a", artist: "b" }], friend: [] })).toBeNull();
  });
  it("caps long text and names", () => {
    const parsed = parseMember({ name: "x".repeat(99), songs: [{ title: "t".repeat(999), artist: "a" }] });
    expect(parsed?.name).toHaveLength(30);
    expect(parsed?.songs[0].title).toHaveLength(200);
  });
});
