// similar.ts against sources that answer sparsely, oddly or not at all. similar.test.ts covers
// the ordinary answers; this file covers every fallback, so a source missing a field never breaks
// the Connection Web.
import { afterEach, describe, expect, it, vi } from "vitest";
import { __clearCache } from "../musicbrainz";
import { mergeArtistCandidates, songCandidates, similarToArtist, similarToSong } from "../similar";
import { fakeWeb, status } from "./fake-web";
import type { Reply } from "./fake-web";

const mb = vi.hoisted(() => ({
  details: {} as Record<string, unknown>,
  recordings: vi.fn<(...args: unknown[]) => Promise<{ id: string; title: string }[]>>(async () => []),
  search: vi.fn<(query: string) => Promise<unknown>>(async () => ({ artists: [] })),
}));
vi.mock("../musicbrainz", async (original) => {
  const actual = await original<typeof import("../musicbrainz")>();
  return {
    ...actual,
    lookupMusicBrainz: vi.fn(async ({ id }: { id: string }) => mb.details[id]),
    findRecordings: mb.recordings,
    musicBrainzContext: vi.fn(async (_path: string, params: { query: string }) => mb.search(params.query)),
  };
});
afterEach(() => {
  __clearCache();
  mb.search.mockReset().mockResolvedValue({ artists: [] });
  mb.recordings.mockReset().mockResolvedValue([]);
  vi.restoreAllMocks();
});

const SELF = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const A = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const B = "cccccccc-3333-4333-8333-cccccccccccc";
const SONG = "dddddddd-4444-4444-8444-dddddddddddd";
const PHOTO = "https://cdn-images.dzcdn.net/images/artist/0123456789abcdef/250x250.jpg";
const artist = (id: string, name: string, tags: string[] = []) => ({ id, name, genres: [], tags, lifeSpan: {}, links: [], type: "Person", country: "" });
const lbSong = (id: string, name: string, credit: string, score?: number) => ({ recording_mbid: id, recording_name: name, artist_credit_name: credit, score });

type Routes = {
  lbArtists?: (mbid: string) => Reply;
  lbSongs?: (mbid: string) => Reply;
  dzSearch?: (name: string) => Reply;
  related?: Reply;
  top?: Reply;
  popularity?: Reply;
  match?: (title: string, artist: string) => Reply;
  compare?: Reply;
};
/** Every source, answering as `routes` says and with nothing otherwise. */
const web = (routes: Routes = {}) =>
  fakeWeb((url) => {
    const q = url.searchParams;
    if (url.pathname === "/similar-artists/json") return routes.lbArtists?.(q.get("artist_mbids")!) ?? [];
    if (url.pathname === "/similar-recordings/json") return routes.lbSongs?.(q.get("recording_mbids")!) ?? [];
    if (url.pathname === "/search/artist") return routes.dzSearch?.(q.get("q")!) ?? { data: [] };
    if (url.pathname.endsWith("/related")) return routes.related ?? {};
    if (url.pathname.endsWith("/top")) return routes.top ?? {};
    if (url.pathname === "/1/popularity/artist") return routes.popularity ?? [];
    if (url.pathname === "/api/match") return routes.match?.(q.get("title")!, q.get("artist")!) ?? {};
    if (url.pathname === "/api/compare") return routes.compare ?? {};
  });
const deezerHas = (name: string, extra = {}) => ({ data: [{ id: 9, name, nb_fan: 10, picture_medium: PHOTO, link: "https://www.deezer.com/artist/9", ...extra }] });
const sound = { env: { SONG_COMPARE_URL: "http://sound" } };

describe("merging the two lists of similar artists", () => {
  it("leaves out rows without a name or id, and the artist itself under any spelling", () => {
    const out = mergeArtistCandidates(
      [{ name: "No id" }, { artist_mbid: A }, { artist_mbid: SELF, name: "Elsewhere" }, { artist_mbid: B, name: "SELF!" }, { artist_mbid: A, name: "Unscored" }],
      [{}, { name: "self" }, { name: "Plain" }],
      SELF,
      "Self",
    );
    expect(out.map((c) => c.name)).toEqual(["Unscored", "Plain"]);
    const plain = out.find((c) => c.name === "Plain")!;
    expect(plain).toMatchObject({ mbid: null, fans: 0, picture: null, deezerUrl: null, sessionScore: 0 });
    // An unscored ListenBrainz row isn't evidence of anything, so it scores nothing.
    expect(out.find((c) => c.name === "Unscored")!.similarity).toBe(0);
  });
});

describe("similar songs from listening rows", () => {
  it("skips rows without an id or title, and copes without a score, credit or cover", () => {
    const out = songCandidates([{ recording_mbid: "x" }, { recording_name: "No id" }, { recording_mbid: "1", recording_name: "Bare" }], ["Seed"], "Seed Artist");
    expect(out).toEqual([expect.objectContaining({ id: "1", name: "Bare", subtitle: "", artist: "", imageUrl: null, similarity: 0 })]);
  });
});

describe("similarToArtist when sources say little", () => {
  it("says ListenBrainz and Deezer found nothing, and still has a center", async () => {
    mb.details[SELF] = artist(SELF, "Self");
    const result = await similarToArtist(SELF, { useCache: false, env: {}, fetchImpl: web({ lbArtists: () => ({ not: "a list" }), dzSearch: () => ({}) }) });
    expect(result.sources).toEqual([{ source: "ListenBrainz", status: "no-match" }, { source: "Deezer", status: "no-match" }]);
    expect(result.artists).toEqual([]);
    expect(result.center).toMatchObject({ subtitle: "", imageUrl: null, listeners: null });
    expect(mb.search).not.toHaveBeenCalledWith(expect.stringContaining("artist:"));
  });

  it("says Deezer failed when its search does, and carries on without related artists", async () => {
    mb.details[SELF] = artist(SELF, "Self");
    const result = await similarToArtist(SELF, { useCache: false, env: {}, fetchImpl: web({ dzSearch: () => status(500) }) });
    expect(result.sources[1]).toEqual({ source: "Deezer", status: "failed" });
  });

  it("picks the Deezer artist with the most fans among exact names, and ignores the rest", async () => {
    mb.details[SELF] = artist(SELF, "Self");
    const fetchImpl = web({
      dzSearch: () => ({ data: [{ name: "Self" }, { id: 1, name: "Self Tribute", nb_fan: 999 }, { id: 2, name: "Self" }, { id: 3, name: "Self", nb_fan: 5 }, { id: 4 }, { id: 6, name: "Self" }, { id: 7, name: "Self", nb_fan: 1 }] }),
      related: {},
      top: {},
    });
    const result = await similarToArtist(SELF, { useCache: false, env: {}, fetchImpl });
    expect(fetchImpl.mock.calls.map(([u]) => String(u))).toContain("https://api.deezer.com/artist/3/related?limit=30");
    expect(result.songs).toEqual([]);
  });

  it("keeps going when related artists, top songs, tags, ids or audience fail", async () => {
    mb.details[SELF] = artist(SELF, "Self", ["pop"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mb.search.mockRejectedValue(new Error("MusicBrainz down"));
    const fetchImpl = web({
      lbArtists: (id) => (id === SELF ? [{ artist_mbid: A, name: "Close", score: 4 }] : status(500)),
      dzSearch: (name) => (name === "Self" ? deezerHas("Self") : { data: [] }),
      related: status(500),
      top: status(500),
      popularity: status(500),
    });
    const result = await similarToArtist(SELF, { useCache: false, env: {}, fetchImpl });
    expect(warn).toHaveBeenCalledWith("[similar] tag lookup failed:", expect.any(Error));
    expect(result.artists).toEqual([
      expect.objectContaining({ name: "Close", subtitle: "", imageUrl: null, listeners: null, reasons: [expect.objectContaining({ kind: "listeners" })] }),
    ]);
    expect(result.links).toEqual([]); // Close's own lookup failed, so there's nothing to link
    expect(result.center.subtitle).toBe("pop");
  });

  it("drops a Deezer-only pick whose id lookup fails, and says why it was listed", async () => {
    mb.details[SELF] = artist(SELF, "Self");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mb.search.mockImplementation(async (query) => {
      if (query.startsWith("artist:")) throw new Error("search failed");
      return {};
    });
    const fetchImpl = web({ dzSearch: () => deezerHas("Self"), related: { data: [{ name: "Only Deezer" }] }, lbArtists: () => [{ artist_mbid: A, name: "Listened" }] });
    const result = await similarToArtist(SELF, { useCache: false, env: {}, fetchImpl });
    expect(warn).toHaveBeenCalledWith("[similar] id lookup failed:", expect.any(Error));
    expect(result.artists.map((a) => a.name)).toEqual(["Listened"]);
  });

  it("finds an id for a Deezer pick only by exact name, and names Deezer as the reason", async () => {
    mb.details[SELF] = artist(SELF, "Self");
    mb.search.mockImplementation(async (query) =>
      query.startsWith("artist:") ? { artists: [{ id: B, name: "Not It" }, { id: A, name: "Deezer Pick" }] } : { artists: [{ id: A, name: "Deezer Pick", tags: [{ name: "rock", count: 1 }] }] });
    const fetchImpl = web({ dzSearch: (name) => (name === "Self" ? deezerHas("Self") : { data: [] }), related: { data: [{ name: "Deezer Pick", nb_fan: 3 }] } });
    const result = await similarToArtist(SELF, { useCache: false, env: {}, fetchImpl });
    expect(result.artists).toEqual([expect.objectContaining({ id: A, subtitle: "rock", imageUrl: null })]);
    expect(result.artists[0].reasons).toEqual([{ kind: "related", text: "Deezer lists Deezer Pick as related to Self.", sourceUrl: undefined }]);
  });

  it("looks for listening data on each recording of a top song, and stops once it has enough songs", async () => {
    mb.details[SELF] = artist(SELF, "Self");
    // 25 titles: the seeds tried are Hit 20, 15, 10, 5 and 0, in that order.
    const titles = Array.from({ length: 25 }, (_, i) => ({ title: `Hit ${i}` }));
    mb.recordings.mockImplementation(async (_id, title) =>
      title === "Hit 20" ? [{ id: "empty", title: "Hit 20" }, { id: "full", title: "Hit 20" }]
        : title === "Hit 15" ? Promise.reject(new Error("down"))
          : [{ id: `r-${title}`, title: title as string }]);
    const seven = (prefix: string) => Array.from({ length: 7 }, (_, i) => lbSong(`${prefix}${i}`, `${prefix} ${i}`, `${prefix} artist ${i}`, 7 - i));
    const lbSongs = vi.fn((id: string) =>
      id === "empty" ? [] : id === "full" ? seven("First") : id === "r-Hit 10" ? status(500) : id === "r-Hit 5" ? seven("Second") : []);
    const fetchImpl = web({ dzSearch: () => deezerHas("Self"), top: { data: [...titles, {}] }, lbSongs });
    const result = await similarToArtist(SELF, { useCache: false, env: {}, fetchImpl });
    // Hit 20's second recording has 7; Hit 15 can't be found and Hit 10's data fails; Hit 5 brings 14.
    expect(result.seedSongs).toEqual(["Hit 20", "Hit 5"]);
    expect(result.songs).toHaveLength(14);
    expect(result.songs.map((s) => s.rank)).toEqual([...Array(14).keys()]);
    expect(lbSongs).not.toHaveBeenCalledWith("r-Hit 0"); // 14 is enough
  });

  it("drops a Deezer pick that MusicBrainz has no artists for", async () => {
    mb.details[SELF] = artist(SELF, "Self");
    mb.search.mockResolvedValue({});
    const fetchImpl = web({ dzSearch: () => deezerHas("Self"), related: { data: [{ name: "Unknown Pick" }] } });
    expect((await similarToArtist(SELF, { useCache: false, env: {}, fetchImpl })).artists).toEqual([]);
  });
});

describe("similarToSong when sources say little", () => {
  const song = (artists: { id?: string; name: string }[], extra = {}) => ({ id: SONG, title: "Seed", artists, ...extra });

  it("says the listening data failed, and keeps the song's own artist", async () => {
    mb.details[SONG] = song([{ id: SELF, name: "Self" }]);
    mb.details[SELF] = artist(SELF, "Self");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await similarToSong(SONG, { useCache: false, env: {}, fetchImpl: web({ lbSongs: () => status(500) }) });
    expect(warn).toHaveBeenCalledWith("[similar] song lookup failed:", expect.anything());
    expect(result.sources).toContainEqual({ source: "ListenBrainz songs", status: "failed" });
    expect(result.center).toMatchObject({ imageUrl: null, artist: "Self" });
  });

  it("tries the song's other recordings when this one has no listening data", async () => {
    mb.details[SONG] = song([{ id: SELF, name: "Self" }]);
    mb.details[SELF] = artist(SELF, "Self");
    mb.recordings.mockResolvedValue([{ id: SONG, title: "Seed" }, { id: "dry", title: "Seed" }, { id: "wet", title: "Seed (Live)" }, { id: "never", title: "Seed" }]);
    const lbSongs = vi.fn((id: string) => (id === "wet" ? [lbSong("s1", "Found", "Self")] : id === "dry" ? status(500) : []));
    const result = await similarToSong(SONG, { useCache: false, env: {}, fetchImpl: web({ lbSongs }) });
    expect(result.songs.map((s) => s.name)).toEqual(["Found"]);
    expect(lbSongs).not.toHaveBeenCalledWith("never");
    expect(result.links).toEqual([]); // Self isn't among the similar artists, so the song links to no one
  });

  it("carries on with no similar songs when its other recordings can't be found", async () => {
    mb.details[SONG] = song([{ id: SELF, name: "Self" }]);
    mb.details[SELF] = artist(SELF, "Self");
    mb.recordings.mockRejectedValue(new Error("MusicBrainz down"));
    const result = await similarToSong(SONG, { useCache: false, env: {}, fetchImpl: web() });
    expect(result.songs).toEqual([]);
    expect(result.sources).not.toContainEqual({ source: "ListenBrainz songs", status: "failed" }); // the data answered; it was empty
  });

  it("works for a song whose artists have no ids, or that has no artists at all", async () => {
    mb.details[SONG] = song([{ name: "Uncredited" }]);
    const one = await similarToSong(SONG, { useCache: false, env: {}, fetchImpl: web({ lbSongs: () => [lbSong("s1", "Close", "Other")] }) });
    expect(one.artists).toEqual([]);
    expect(one.songs[0].reasons[0].text).toContain("by Uncredited");
    expect(mb.recordings).not.toHaveBeenCalled();

    mb.details[SONG] = song([]);
    const none = await similarToSong(SONG, { useCache: false, env: {}, fetchImpl: web({ lbSongs: () => [lbSong("s1", "Close", "Other")] }) });
    expect(none.songs[0].reasons[0].text).toContain("by this artist");
    expect(none.center).toMatchObject({ subtitle: "", artist: undefined });
  });
});

describe("sound reasons from the Song Compare service", () => {
  const withSongs = () => {
    mb.details[SONG] = { id: SONG, title: "Seed", artists: [{ name: "Self" }] };
  };
  const rows = () => [lbSong("s1", "One", "A feat. B", 3), lbSong("s2", "Two", "C", 2), lbSong("s3", "Three", "D", 1)];

  it("stays quiet about a seed outside its catalog, but says when the service is down", async () => {
    withSongs();
    const outside = await similarToSong(SONG, { useCache: false, ...sound, fetchImpl: web({ lbSongs: rows, match: () => status(404) }) });
    expect(outside.sources.find((s) => s.source === "Song Compare")).toBeUndefined();
    const down = await similarToSong(SONG, { useCache: false, ...sound, fetchImpl: web({ lbSongs: rows, match: () => status(503) }) });
    expect(down.sources).toContainEqual({ source: "Song Compare", status: "no-key" });
  });

  it("says nothing when the seed has no match, and skips songs without one or with the seed's", async () => {
    withSongs();
    const noSeed = await similarToSong(SONG, { useCache: false, ...sound, fetchImpl: web({ lbSongs: rows, match: () => ({}) }) });
    expect(noSeed.songs.every((s) => s.reasons.length === 1)).toBe(true);
    const matchFor = (title: string, credit: string) => ({ Seed: { track: { id: "seed" } }, One: credit === "A" ? { track: { id: "seed" } } : {}, Two: {}, Three: { track: { id: "t3" } } })[title];
    const compare = vi.fn(() => ({ audio: {}, reasons: undefined }));
    const result = await similarToSong(SONG, { useCache: false, ...sound, fetchImpl: web({ lbSongs: rows, match: matchFor, compare: compare() }) });
    expect(result.songs.every((s) => s.reasons.length === 1)).toBe(true); // no score, so no sound reason
    expect(result.sources).toContainEqual({ source: "Song Compare", status: "ok" });
  });

  it("explains a match without the reasons it doesn't use", async () => {
    withSongs();
    const fetchImpl = web({ lbSongs: rows, match: (title) => ({ track: { id: title } }), compare: { audio: { score: 0.5 }, reasons: ["Both lean toward love."] } });
    const result = await similarToSong(SONG, { useCache: false, ...sound, fetchImpl });
    expect(result.songs[0].reasons.at(-1)).toEqual({ kind: "sound", text: "Calculated sound match: 50%." });
  });
});
