import { afterEach, describe, expect, it, vi } from "vitest";
import { __clearCache } from "../musicbrainz";
import { mergeArtistCandidates, rankArtists, seedTitles, sharedTags, similarToArtist, similarToSong, songCandidates } from "../similar";

type FetchMock = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const SELF = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const THIRD = "cccccccc-3333-4333-8333-cccccccccccc";
const SONG = "dddddddd-4444-4444-8444-dddddddddddd";
const FOUND = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";

const details: Record<string, object> = {};
const search = vi.fn();
vi.mock("../musicbrainz", async (original) => {
  const actual = await original<typeof import("../musicbrainz")>();
  return {
    ...actual,
    lookupMusicBrainz: vi.fn(async ({ id }: { id: string }) => details[id]),
    findRecordings: vi.fn(async () => [{ id: SONG, title: "Hit" }]),
    musicBrainzContext: vi.fn(async (_path: string, params: { query: string }) => search(params.query)),
  };
});
afterEach(() => { __clearCache(); search.mockReset(); });

describe("mergeArtistCandidates", () => {
  const lb = [{ artist_mbid: OTHER, name: "Close", score: 100 }, { artist_mbid: THIRD, name: "Further", score: 50 }, { artist_mbid: SELF, name: "Self", score: 999 }];
  it("scores relative to the closest match, and leaves out the artist itself", () => {
    const out = mergeArtistCandidates(lb, [], SELF, "Self");
    expect(out.map((c) => c.name)).toEqual(["Close", "Further"]);
    expect(out[0].similarity).toBeGreaterThan(out[1].similarity);
    expect(out[0].similarity).toBeLessThanOrEqual(1);
  });
  it("counts being on both lists for more than one, and a Deezer-only artist for least", () => {
    const out = mergeArtistCandidates(lb, [{ name: "Further", nb_fan: 10 }, { name: "Deezer Only", nb_fan: 5 }], SELF, "Self");
    const by = (name: string) => out.find((c) => c.name === name)!;
    expect(by("Further").similarity).toBeGreaterThan(.5 * .85);
    expect(by("Further").fans).toBe(10);
    expect(by("Deezer Only").mbid).toBeNull();
    expect(by("Deezer Only").similarity).toBeLessThanOrEqual(.6);
  });
  it("ignores Deezer's generic silhouette", () => {
    const out = mergeArtistCandidates([], [{ name: "A", picture_medium: "https://cdn-images.dzcdn.net/images/artist//250x250.jpg" }, { name: "B", picture_medium: "https://cdn-images.dzcdn.net/images/artist/2c9e480317183c037eaebcd7ba96daf4/250x250.jpg" }], SELF, "Self");
    expect(out.map((c) => !!c.picture)).toEqual([false, true]);
  });
});

describe("rankArtists", () => {
  it("leans toward well-known names, without burying a much closer match", () => {
    const ranked = rankArtists([{ name: "Obscure", similarity: .5, fans: 10 }, { name: "Famous", similarity: .5, fans: 10_000_000 }, { name: "Closest", similarity: 1, fans: 100 }]);
    expect(ranked.map((a) => a.name)).toEqual(["Closest", "Famous", "Obscure"]);
  });
});

describe("sharedTags", () => {
  it("keeps the artist's own order, ignoring case", () => {
    expect(sharedTags(["pop", "Rock", "indie"], ["INDIE", "rock"])).toEqual(["Rock", "indie"]);
  });
});

describe("seedTitles", () => {
  it("spreads across the list, starts further down, and skips repeats", () => {
    const titles = Array.from({ length: 25 }, (_, i) => `Song ${i}`);
    const seeds = seedTitles(titles);
    expect(seeds).toHaveLength(5);
    expect(seeds[0]).not.toBe("Song 0");
    expect(seedTitles(["A", "a!", "B"])).toEqual(["B", "A"]);
  });
});

describe("songCandidates", () => {
  const song = (id: string, name: string, artist: string, score: number) => ({ recording_mbid: id, recording_name: name, artist_credit_name: artist, score, caa_id: 7, caa_release_mbid: "r" });
  it("leaves out versions of the seed, counts versions of a song once, and limits each artist", () => {
    const out = songCandidates([
      song("1", "Seed Song (Live)", "X", 90), song("2", "Other", "A", 80), song("3", "Other - Remastered", "A", 70),
      song("4", "Two", "A", 60), song("5", "Three", "A feat. B", 50), song("6", "Different", "C", 40),
    ], ["Seed Song"], "Seed Artist");
    expect(out.map((s) => s.name)).toEqual(["Other", "Two", "Different"]);
  });
  it("scores against the best match, links its art, and says why", () => {
    const [first, second] = songCandidates([song("2", "Other", "A", 80), song("6", "Different", "C", 40)], ["Seed"], "Seed Artist");
    expect(first.similarity).toBe(1);
    expect(second.similarity).toBe(.5);
    expect(first.imageUrl).toBe("https://coverartarchive.org/release/r/7-250.jpg");
    expect(first.reasons[0].text).toContain("“Seed” by Seed Artist");
  });
});

const artistDetails = (id: string, name: string) => ({ id, name, genres: [{ name: "pop", count: 5 }], tags: ["pop"], lifeSpan: {}, links: [], type: "Person", country: "US" });

const fetchFor = (over: { labsSongs?: unknown; failLabs?: boolean; sound?: Record<string, unknown> } = {}) => vi.fn<FetchMock>(async (input) => {
  const url = String(input);
  if (url.includes("similar-artists")) {
    if (over.failLabs) return { ok: false, status: 503, json: async () => ({}) } as Response;
    return ok(url.includes(SELF) ? [{ artist_mbid: OTHER, name: "Close", score: 100 }] : [{ artist_mbid: THIRD, name: "Third", score: 3 }]);
  }
  if (url.includes("similar-recordings")) return ok(over.labsSongs ?? [{ recording_mbid: "s1", recording_name: "Their Song", artist_credit_name: "Close", score: 10 }]);
  if (url.includes("/search/artist")) return ok({ data: [{ id: 9, name: decodeURIComponent(url.match(/q=([^&]+)/)![1]), nb_fan: 100, picture_medium: "https://cdn-images.dzcdn.net/images/artist/abcdef012345/250x250.jpg", link: "https://www.deezer.com/artist/9" }] });
  if (url.includes("/related")) return ok({ data: [{ name: "Deezer Pick", nb_fan: 50, link: "https://www.deezer.com/artist/8" }] });
  if (url.includes("/top")) return ok({ data: [{ title: "Hit" }] });
  if (url.includes("popularity/artist")) return ok([{ artist_mbid: OTHER, total_listen_count: 10, total_user_count: 2 }]);
  for (const [fragment, body] of Object.entries(over.sound ?? {})) if (url.includes(fragment)) return ok(body);
  throw new Error(`unexpected ${url}`);
});

describe("similarToArtist", () => {
  it("returns similar artists and songs with reasons, links and sources, and drops what it can't open", async () => {
    details[SELF] = artistDetails(SELF, "Self");
    search.mockImplementation(async (query: string) => (query.includes("arid:") ? { artists: [{ id: OTHER, name: "Close", tags: [{ name: "pop", count: 3 }] }] } : { artists: [] }));
    const web = await similarToArtist(SELF, { fetchImpl: fetchFor(), useCache: false, env: {} });
    expect(web.center).toMatchObject({ kind: "artist", name: "Self", similarity: 1 });
    expect(web.artists.map((a) => a.name)).toEqual(["Close"]); // "Deezer Pick" has no MusicBrainz id
    const close = web.artists[0];
    expect(close.reasons.map((r) => r.kind)).toEqual(["listeners", "style"]);
    expect(close.reasons[1].text).toBe("Both tagged pop on MusicBrainz.");
    expect(close.listeners).toBe(2);
    expect(close.imageUrl).toContain("abcdef012345");
    expect(web.songs.map((s) => s.name)).toEqual(["Their Song"]);
    expect(web.links).toContainEqual({ from: OTHER, to: "s1", kind: "performed" });
    expect(web.seedSongs).toEqual(["Hit"]);
    expect(web.sources).toEqual([{ source: "ListenBrainz", status: "ok" }, { source: "Deezer", status: "ok" }]);
  });

  it("finds a MusicBrainz id for an artist only Deezer listed, by exact name", async () => {
    details[SELF] = artistDetails(SELF, "Self");
    search.mockImplementation(async (query: string) => (query.includes("arid:") ? { artists: [] } : { artists: [{ id: FOUND, name: "Deezer Pick" }] }));
    const web = await similarToArtist(SELF, { fetchImpl: fetchFor(), useCache: false, env: {} });
    expect(web.artists.find((a) => a.name === "Deezer Pick")).toMatchObject({ id: FOUND });
  });

  it("still answers when ListenBrainz is down, and reports it", async () => {
    details[SELF] = artistDetails(SELF, "Self");
    search.mockResolvedValue({ artists: [] });
    const web = await similarToArtist(SELF, { fetchImpl: fetchFor({ failLabs: true }), useCache: false, env: {} });
    expect(web.sources[0]).toEqual({ source: "ListenBrainz", status: "failed" });
  });
});

describe("similarToSong", () => {
  beforeSong();
  function beforeSong() {
    details[SONG] = { id: SONG, title: "Seed", artists: [{ id: SELF, name: "Self" }], representative: { artUrl: "https://coverartarchive.org/x" } };
    details[SELF] = artistDetails(SELF, "Self");
  }

  it("adds a calculated sound reason when the sound service answers", async () => {
    search.mockResolvedValue({ artists: [] });
    const web = await similarToSong(SONG, {
      useCache: false,
      env: { SONG_COMPARE_URL: "http://sound" },
      fetchImpl: fetchFor({ sound: { "/api/match": { track: { id: "t" } }, "/api/compare": { audio: { score: .72 }, reasons: ["Very close on energy and valence.", "Both lean toward love."] } } }),
    });
    expect(web.center).toMatchObject({ kind: "song", name: "Seed", subtitle: "Self" });
    expect(web.songs[0].reasons.some((r) => r.kind === "sound")).toBe(false); // Same catalog id as the seed: nothing to compare.
  });

  it("explains the sound of a different song, in plain words", async () => {
    search.mockResolvedValue({ artists: [] });
    let calls = 0;
    const base = fetchFor();
    const web = await similarToSong(SONG, {
      useCache: false,
      env: { SONG_COMPARE_URL: "http://sound" },
      fetchImpl: vi.fn<FetchMock>(async (input, init) => {
        const url = String(input);
        if (url.includes("/api/match")) return ok({ track: { id: `t${calls++}` } });
        if (url.includes("/api/compare")) return ok({ audio: { score: .72 }, reasons: ["Very close on energy and valence.", "Both lean toward love."] });
        return base(input, init);
      }),
    });
    expect(web.songs[0].reasons.at(-1)).toEqual({ kind: "sound", text: "Calculated sound match: 72%. Very close on energy and positivity." });
    expect(web.sources.find((s) => s.source === "Song Compare")?.status).toBe("ok");
  });

  it("says the sound service isn't set up, and keeps everything else", async () => {
    search.mockResolvedValue({ artists: [] });
    const web = await similarToSong(SONG, { useCache: false, env: {}, fetchImpl: fetchFor() });
    expect(web.sources.find((s) => s.source === "Song Compare")?.status).toBe("no-key");
    expect(web.songs.length).toBeGreaterThan(0);
  });
});
