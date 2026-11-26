import { describe, expect, it, vi } from "vitest";
import { buildTaste, buildTasteMap, parseMember, parseTasteRequest, shelfOf } from "../taste";
import type { SimilarRow } from "../taste";
import type { TasteMap, TasteRequest } from "../types";
import { asked, fakeWeb, quick, status } from "./fake-web";
import type { Reply } from "./fake-web";

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

describe("buildTaste: the map from the playlists, with every source asked", () => {
  const OLIVIA = "6925db17-f35e-42f3-a4eb-84ee6bf5d4b0";
  const TAYLOR = "20244d07-534f-4eff-b4d4-930878889970";
  const PHOEBE = "0f2d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b";
  const GRACIE = "a1b2c3d4-0000-4000-8000-000000000001";
  const PHOTO = (n: number) => `https://cdn-images.dzcdn.net/images/artist/2c9e480317183c037eaebcd7ba96daf${n}/250x250.jpg`;
  const COVER = "https://cdn-images.dzcdn.net/images/cover/abc/250x250.jpg";
  const mbArtists = [
    { id: OLIVIA, name: "Olivia Rodrigo" },
    { id: "ffffffff-0000-4000-8000-000000000000", name: "Olivia Rodrigo" }, // a second with the name: the first wins
    { id: TAYLOR, name: "Taylor Swift" },
    { id: PHOEBE, name: "Phoebe Bridgers" },
    { id: "eeeeeeee-0000-4000-8000-000000000000", name: "Olivia Rodrigo Tribute" }, // not exact
  ];
  const similarFor: Record<string, unknown> = {
    [OLIVIA]: [{ artist_mbid: GRACIE, name: "Gracie Abrams", score: 9 }, { artist_mbid: "", name: "No id" }, { artist_mbid: PHOEBE, name: "Phoebe Bridgers" }],
    [TAYLOR]: [{ artist_mbid: GRACIE, name: "Gracie Abrams" }],
    [PHOEBE]: status(500),
  };
  const web = (overrides: { mb?: Reply; dzTrack?: (q: string) => Reply } = {}) =>
    fakeWeb((url) => {
      if (url.host === "musicbrainz.org") return overrides.mb ?? { artists: mbArtists };
      if (url.host === "labs.api.listenbrainz.org") return similarFor[url.searchParams.get("artist_mbids")!] ?? [];
      if (url.pathname === "/search/artist") {
        const q = url.searchParams.get("q")!;
        return q === "Nobody Known" ? { data: [] } : { data: [{ id: 1, name: q, nb_fan: 5, picture_medium: PHOTO(q.length % 10) }] };
      }
      if (url.pathname === "/search/track") return overrides.dzTrack ? overrides.dzTrack(url.searchParams.get("q")!) : {};
    });
  const request: TasteRequest = {
    mine: songs(["vampire", "Olivia Rodrigo"], ["drivers license", "Olivia Rodrigo"], ["Motion Sickness", "Phoebe Bridgers"], ["Unlisted", "Nobody Known"]),
    friend: songs(["Anti-Hero", "Taylor Swift"], ["vampire", "Olivia Rodrigo"]),
    friendName: "Sam",
  };
  const byName = (map: TasteMap, name: string) => map.nodes.find((n) => n.name === name)!;

  it("looks each artist up by exact name, asks who listeners connect them to, and finds pictures", async () => {
    const fetchImpl = web({
      dzTrack: (q) => q.startsWith("Anti-Hero") ? new TypeError("offline")
        : { data: [{ title: "vampire (live)", title_short: "vampire", artist: { name: "Olivia Rodrigo" }, album: { cover_medium: COVER } }, { title: "Other" }] },
    });
    const map = await buildTaste(request, { ...quick, fetchImpl });

    const query = new URL(asked(fetchImpl).find((u) => u.includes("musicbrainz.org"))!).searchParams.get("query");
    expect(query).toBe('artist:"Olivia Rodrigo" OR artist:"Phoebe Bridgers" OR artist:"Nobody Known" OR artist:"Taylor Swift"');
    expect(byName(map, "Olivia Rodrigo").mbid).toBe(OLIVIA);
    expect(byName(map, "Nobody Known").mbid).toBeNull();
    // Gracie is close to both playlists' artists (Olivia is on both), so she's new to both, and why says so.
    expect(byName(map, "Gracie Abrams")).toMatchObject({ group: "new", mbid: GRACIE });
    expect(byName(map, "Gracie Abrams").reasons[0].text).toBe(
      "New to both of you: people who play Olivia Rodrigo (yours) and Olivia Rodrigo and Taylor Swift (Sam’s) often play Gracie Abrams too.",
    );
    expect(map.nodes.some((n) => n.name === "No id")).toBe(false);
    expect(byName(map, "Olivia Rodrigo").imageUrl).toBe(PHOTO("Olivia Rodrigo".length % 10));
    expect(byName(map, "Nobody Known").imageUrl).toBeNull();
    expect(map.nodes.find((n) => n.kind === "song" && n.name === "vampire")!.imageUrl).toBe(COVER);
    expect(map.nodes.find((n) => n.kind === "song" && n.name === "Unlisted")!.imageUrl).toBeNull();
    expect(map.sources).toEqual([
      { source: "MusicBrainz", status: "ok" },
      { source: "ListenBrainz", status: "partial" }, // Phoebe's lookup failed
      { source: "Deezer", status: "partial" }, // one cover search failed
    ]);
  });

  it("still maps the playlists when MusicBrainz fails, and says nothing could be checked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = await buildTaste({ mine: request.mine }, { ...quick, fetchImpl: web({ mb: status(404) }) });
    expect(warn).toHaveBeenCalledWith("[taste] artist lookup failed:", expect.anything());
    warn.mockRestore();
    expect(map.sources.slice(0, 2)).toEqual([{ source: "MusicBrainz", status: "failed" }, { source: "ListenBrainz", status: "no-match" }]);
    expect(map.nodes.filter((n) => n.group === "new")).toEqual([]);
    expect(map.nodes.map((n) => n.name)).toContain("Phoebe Bridgers");
    expect(map.sources[2]).toEqual({ source: "Deezer", status: "ok" });
  });

  it("says ListenBrainz failed only when every lookup did", async () => {
    const fetchImpl = fakeWeb((url) => url.host === "musicbrainz.org" ? { artists: [{ id: PHOEBE, name: "Phoebe Bridgers" }] }
      : url.host === "labs.api.listenbrainz.org" ? status(500) : { data: [] });
    const map = await buildTaste({ mine: songs(["Motion Sickness", "Phoebe Bridgers"]) }, { ...quick, fetchImpl });
    expect(map.sources[1]).toEqual({ source: "ListenBrainz", status: "failed" });
  });

  it("asks nothing when no artist has a name to look up", async () => {
    const fetchImpl = fakeWeb(() => ({ data: [] }));
    const map = await buildTaste({ mine: songs(["Song", "???"]) }, { ...quick, fetchImpl });
    expect(asked(fetchImpl).some((u) => u.includes("musicbrainz.org"))).toBe(false);
    expect(map.sources[1]).toEqual({ source: "ListenBrainz", status: "no-match" });
  });

  it("reports every source as fine when they all answer", async () => {
    const map = await buildTaste({ mine: songs(["Anti-Hero", "Taylor Swift"]) }, { ...quick, fetchImpl: web() });
    expect(map.sources.map((s) => s.status)).toEqual(["ok", "ok", "ok"]);
    expect(byName(map, "Gracie Abrams").reasons[0].text).toBe("New to you: people who play Taylor Swift often play Gracie Abrams too.");
  });
});

describe("the corners of a taste map", () => {
  it("keeps a friend's playlist in a request, and drops a blank friend name", () => {
    expect(parseTasteRequest({ mine: songs(["a", "b"]), friend: songs(["c", "d"]), friendName: "   " })).toEqual({ mine: songs(["a", "b"]), friend: songs(["c", "d"]) });
  });

  it("refuses a room member without songs, and names one without a name ''", () => {
    expect(parseMember({ name: "Sam", songs: [] })).toBeNull();
    expect(parseMember(null)).toBeNull();
    expect(parseMember({ name: 7, songs: songs(["a", "b"]) })).toEqual({ name: "", songs: songs(["a", "b"]) });
  });

  it("counts a song once, however it's written", () => {
    const shelf = shelfOf(songs(["vampire", "Olivia Rodrigo"], ["vampire (Live)", "Olivia Rodrigo feat. Someone"], ["Vampire - Remastered", "OLIVIA RODRIGO"]));
    expect(shelf.songs.size).toBe(1);
    expect(shelf.artists.get("oliviarodrigo")!.songs).toHaveLength(1);
  });

  it("names three artists in full, and more as a count", () => {
    const friend4 = shelfOf(songs(["1", "A1"], ["2", "B2"], ["3", "C3"], ["4", "D4"]));
    const four = buildTasteMap(shelfOf(songs(["x", "Mine"])), friend4, similar({ Mine: ["A1", "B2", "C3", "D4"] }), new Map(), "Sam");
    expect(node(four, "Mine").reasons[1].text).toContain("people who play A1, B2, C3 and 1 more, on Sam’s playlist");
    const friend3 = shelfOf(songs(["1", "A1"], ["2", "B2"], ["3", "C3"]));
    const three = buildTasteMap(shelfOf(songs(["x", "Mine"])), friend3, similar({ Mine: ["A1", "B2", "C3"] }), new Map(), "Sam");
    expect(node(three, "Mine").reasons[1].text).toContain("people who play A1, B2 and C3, on Sam’s playlist");
  });

  it("draws one line from an artist both of you play, however each of you wrote the name", () => {
    const map = buildTasteMap(shelfOf(songs(["x", "Olivia Rodrigo"])), shelfOf(songs(["y", "OLIVIA RODRIGO"])), similar({ "Olivia Rodrigo": ["Fresh"] }), new Map());
    expect(map.links.filter((l) => l.kind === "recommended")).toEqual([{ from: "artist:oliviarodrigo", to: "artist:fresh", kind: "recommended" }]);
  });

  it("alone, puts what several of your artists lead to first", () => {
    const map = buildTasteMap(mine, null, similar({ Lorde: ["Once", "Twice"], SZA: ["Twice"] }), new Map());
    expect(map.nodes.filter((n) => n.group === "new").map((n) => n.name)).toEqual(["Twice", "Once"]);
  });

  it("with a friend, breaks ties between suggestions by how many artists lead to them", () => {
    const map = build({ "Olivia Rodrigo": ["Both A", "Both B"], Lorde: ["Both B"], "Kendrick Lamar": ["Both A", "Both B"] });
    expect(map.nodes.filter((n) => n.group === "new").map((n) => n.name)).toEqual(["Both B", "Both A"]);
  });

  it("suggests from an artist too far down the playlist to be shown, without a line to it", () => {
    const fifteen = shelfOf(Array.from({ length: 15 }, (_, i) => [`Song ${i}`, `Artist ${String.fromCharCode(65 + i)}`] as [string, string]).map(([title, artist]) => ({ title, artist })));
    const map = buildTasteMap(fifteen, null, similar({ "Artist O": ["Fresh"] }), new Map());
    expect(map.nodes.some((n) => n.name === "Artist O")).toBe(false);
    expect(node(map, "Fresh").group).toBe("new");
    expect(map.links.filter((l) => l.to === "artist:fresh")).toEqual([]);
  });

  it("copes with MusicBrainz finding no artists and Deezer rows missing every field", async () => {
    const rows = [{}, { artist: { name: "Someone" } }, { title: "Song", artist: { name: "Someone" }, album: {} }];
    const fetchImpl = fakeWeb((url) => url.host === "musicbrainz.org" ? {} : url.pathname === "/search/track" ? { data: rows } : {});
    const map = await buildTaste({ mine: songs(["Song", "Someone"]) }, { ...quick, fetchImpl });
    expect(map.nodes.map((n) => [n.name, n.mbid, n.imageUrl])).toEqual([["Someone", null, null], ["Song", null, null]]);
    expect(map.sources.map((s) => s.status)).toEqual(["ok", "no-match", "ok"]);
  });
});
