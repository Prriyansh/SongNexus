// The other sources (Genius, Discogs, Last.fm, ListenBrainz, Wikidata) answering sparsely, oddly or
// not at all, and the two features that combine them. sources.test.ts and more-credits.test.ts
// cover the ordinary answers; this file covers every fallback.
import { afterEach, describe, expect, it, vi } from "vitest";
import { __clearCache } from "../musicbrainz";
import { addCredit, commonPeople, envOf, scanInOrder, sourceJson } from "../credit-sources";
import type { SourcedPeople } from "../credit-sources";
import { discogsCredits } from "../discogs";
import { geniusCredits } from "../genius";
import { lastFmAudience, lastFmSimilar } from "../lastfm";
import { listenBrainzAudience } from "../listenbrainz";
import { artistFacts } from "../wikidata";
import { artistInsights } from "../artist-insights";
import { moreCredits } from "../more-credits";
import { fakeWeb, quick, status } from "./fake-web";

const A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const lookups = vi.hoisted(() => ({ byId: {} as Record<string, unknown> }));
vi.mock("../musicbrainz", async (original) => {
  const actual = await original<typeof import("../musicbrainz")>();
  return { ...actual, lookupMusicBrainz: vi.fn(async ({ id }: { id: string }) => lookups.byId[id]) };
});
afterEach(() => {
  __clearCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  lookups.byId = {};
});
const opts = { ...quick, env: {} };
const work = { title: "T", url: "u", year: "2020" };

describe("shared request helpers", () => {
  it("use the server's settings and fetch unless told otherwise", async () => {
    expect(envOf({})).toBe(process.env);
    const fetchImpl = fakeWeb(() => ({ ok: 1 }));
    vi.stubGlobal("fetch", fetchImpl);
    expect(await sourceJson("Test", "https://example.com/x")).toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("order people credited equally often by how often in all, then by name", () => {
    const people = (counts: Record<string, number>): SourcedPeople => {
      const map: SourcedPeople = new Map();
      for (const [name, n] of Object.entries(counts)) {
        for (let i = 0; i < n; i++) addCredit(map, name, name, `u/${name}`, "producer", { ...work, url: `${name}${i}` });
      }
      return map;
    };
    const a = people({ Zed: 1, Amy: 1, Bob: 3 });
    const b = people({ Zed: 1, Amy: 1, Bob: 1 });
    expect(commonPeople("genius", a, b, []).map((p) => p.name)).toEqual(["Bob", "Amy", "Zed"]);
  });

  it("wait between steps, pass on a first failure, and keep what finished after a later one", async () => {
    const at: number[] = [];
    await scanInOrder([1, 2], 10_000, 30, async () => { at.push(Date.now()); });
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(25);
    await expect(scanInOrder([1], 10_000, 0, async () => { throw new Error("first"); })).rejects.toThrow("first");
    expect(await scanInOrder([1, 2], 10_000, 0, async (n) => { if (n === 2) throw new Error("second"); })).toEqual({ scanned: 1, complete: false });
  });
});

describe("Discogs with little to go on", () => {
  it("reads nothing from a listing without releases", async () => {
    expect(await discogsCredits("7", [], { ...opts, fetchImpl: fakeWeb(() => ({})) })).toEqual({ people: new Map(), scanned: 0, complete: true });
  });

  it("names what a release leaves out, and skips credits without an id, a name or a role", async () => {
    const listing = { releases: [{ type: "master", role: "Main", main_release: 3, year: 2019 }, { type: "master", role: "Main", main_release: 4 }] };
    const fetchImpl = fakeWeb((url) => url.pathname.endsWith("/releases") ? listing
      : url.pathname === "/releases/3" ? { extraartists: [{ name: "No id", role: "Producer" }, { id: 9 }, { id: 11, name: "Mixer (2)", role: "Mixed By" }], tracklist: [{}] }
        : url.pathname === "/releases/4" ? { tracklist: [{ extraartists: [{ id: 10, name: "Pat", role: "Producer" }] }] } : undefined);
    const { people } = await discogsCredits("7", [], { ...opts, fetchImpl });
    expect([...people.keys()].sort()).toEqual(["10", "11"]);
    expect([...people.get("11")!.work.values()]).toEqual([{ title: "Untitled release", url: "https://www.discogs.com/release/3", year: "2019" }]);
    expect([...people.get("10")!.work.values()][0].year).toBe("");
  });
});

describe("Genius with little to go on", () => {
  const self = { id: 5, name: "Self", url: "https://genius.com/artists/Self" };
  const search = { response: { hits: [{}, { result: {} }, { result: { primary_artist: { id: 1 } } }, { result: { primary_artist: self } }] } };
  const songs = (n: number) => ({ response: { songs: Array.from({ length: n }, (_, i) => ({ id: 100 + i, primary_artist: self })) } });
  const genius = (songPage: unknown, song: (id: number) => unknown) =>
    fakeWeb((url) => url.pathname === "/search" ? search : url.pathname.endsWith("/songs") ? songPage : song(Number(url.pathname.split("/").pop())));

  it("finds no artist in a search without hits", async () => {
    expect(await geniusCredits({ name: "Self" }, "t", { ...opts, fetchImpl: fakeWeb(() => ({ response: {} })) })).toBeNull();
  });

  it("finds no credits for an artist without songs", async () => {
    expect(await geniusCredits({ name: "Self" }, "t", { ...opts, fetchImpl: genius({ response: {} }, () => undefined) })).toMatchObject({ artistId: "5", scanned: 0, complete: true });
  });

  it("names what a song leaves out, and skips people without an id, a name or a role", async () => {
    const bare = { response: { song: { producer_artists: [{ name: "No id" }, { id: 20 }, { id: 22, name: "Named" }], custom_performances: [{ artists: [{ id: 21, name: "Helper" }] }] } } };
    const result = await geniusCredits({ name: "Self" }, "t", { ...opts, fetchImpl: genius(songs(1), () => bare) });
    expect([...result!.people.keys()]).toEqual(["22"]); // 21's performance has no label, so no role
    expect(result!.people.get("22")).toMatchObject({ name: "Named", url: "" });
    expect([...result!.people.get("22")!.work.values()]).toEqual([{ title: "Untitled song", url: "", year: "" }]);
  });

  it("stops between batches when time runs out", async () => {
    const result = await geniusCredits({ name: "Self" }, "t", { ...opts, budgetMs: -1, fetchImpl: genius(songs(6), () => ({ response: { song: { title: "S" } } })) });
    expect([result!.scanned, result!.complete]).toEqual([4, false]);
  });

  it("fails when every song in the first batch does, but not when they only lack details", async () => {
    await expect(geniusCredits({ name: "Self" }, "t", { ...opts, fetchImpl: genius(songs(2), () => status(500)) })).rejects.toThrow("Genius");
    expect(await geniusCredits({ name: "Self" }, "t", { ...opts, fetchImpl: genius(songs(2), () => ({ response: {} })) })).toMatchObject({ scanned: 0, complete: false });
  });
});

describe("Last.fm with little to go on", () => {
  const lastFm = (info: unknown, similar: unknown = {}) => fakeWeb((url) => (url.searchParams.get("method") === "artist.getinfo" ? info : similar));

  it("treats an unknown artist as no data, and fails on any other error", async () => {
    expect(await lastFmAudience(A, "k", { ...opts, fetchImpl: lastFm(status(404)) })).toBeNull();
    expect(await lastFmAudience(A, "k", { ...opts, fetchImpl: lastFm({ error: 6, message: "not found" }) })).toBeNull();
    await expect(lastFmAudience(A, "k", { ...opts, fetchImpl: lastFm({ error: 29, message: "rate limited" }) })).rejects.toThrow("Last.fm error 29.");
    await expect(lastFmAudience(A, "k", { ...opts, fetchImpl: lastFm(status(500)) })).rejects.toThrow("Last.fm");
  });

  it("reads plays under either name, and has no audience without listeners or a link", async () => {
    const artist = (stats: object, url: string | null = "https://last.fm/a") => ({ artist: { ...(url ? { url } : {}), stats } });
    expect(await lastFmAudience(A, "k", { ...opts, fetchImpl: lastFm(artist({ listeners: "10", plays: "30" })) })).toEqual({ listeners: 10, plays: 30, url: "https://last.fm/a" });
    expect(await lastFmAudience(A, "k", { ...opts, fetchImpl: lastFm(artist({ listeners: "10" })) })).toMatchObject({ plays: 0 });
    expect(await lastFmAudience(A, "k", { ...opts, fetchImpl: lastFm(artist({ listeners: "many" })) })).toBeNull();
    expect(await lastFmAudience(A, "k", { ...opts, fetchImpl: lastFm(artist({ listeners: "10" }, null)) })).toBeNull();
    expect(await lastFmAudience(A, "k", { ...opts, fetchImpl: lastFm({ artist: {} }) })).toBeNull();
  });

  it("lists only similar artists with a name and a link, and none for an unknown artist", async () => {
    const similar = { similarartists: { artist: [{ name: "Has all", url: "u1", mbid: B }, { name: "No id", url: "u2", mbid: "" }, { name: "No link" }, { url: "u3" }] } };
    expect(await lastFmSimilar(A, "k", { ...opts, fetchImpl: lastFm({}, similar) })).toEqual([
      { name: "Has all", mbid: B, url: "u1" },
      { name: "No id", mbid: null, url: "u2" },
    ]);
    expect(await lastFmSimilar(A, "k", { ...opts, fetchImpl: lastFm({}, status(404)) })).toEqual([]);
    expect(await lastFmSimilar(A, "k", { ...opts, fetchImpl: lastFm({}, {}) })).toEqual([]);
  });
});

describe("ListenBrainz with little to go on", () => {
  it("reads nothing from a reply that isn't a list, and no listens as zero", async () => {
    expect(await listenBrainzAudience([A], { ...opts, fetchImpl: fakeWeb(() => ({})) })).toEqual(new Map());
    const rows = [{ artist_mbid: A, total_user_count: 3, total_listen_count: null }];
    expect((await listenBrainzAudience([A], { ...opts, fetchImpl: fakeWeb(() => rows) })).get(A)).toMatchObject({ listeners: 3, listens: 0 });
  });
});

describe("Wikidata with little to go on", () => {
  const facts = (entity: unknown, labels: unknown = {}, summary: unknown = undefined) =>
    fakeWeb((url) => url.host === "en.wikipedia.org" ? summary : url.searchParams.get("props") === "labels" ? labels : { entities: { Q1: entity } });

  it("has no facts for an entity without claims", async () => {
    expect(await artistFacts("Q1", { ...opts, fetchImpl: facts({}) })).toBeNull();
    expect(await artistFacts("Q1", { ...opts, fetchImpl: fakeWeb(() => ({})) })).toBeNull();
  });

  it("leaves out what has no id or English name, and fills in what's missing", async () => {
    const entity = { claims: { P166: [{ mainsnak: {} }, { mainsnak: { datavalue: { value: { id: "Q9" } } } }], P2031: [{ mainsnak: {} }] } };
    expect(await artistFacts("Q1", { ...opts, fetchImpl: facts(entity, {}) })).toMatchObject({ description: "", activeFrom: "", awards: [], wikipedia: null });
    expect(await artistFacts("Q1", { ...opts, fetchImpl: facts(entity, { entities: { Q9: {} } }) })).toMatchObject({ awards: [] });
  });

  it("links the article from Wikidata when Wikipedia doesn't, and has no summary without text or a link", async () => {
    const entity = (url?: string) => ({ claims: {}, sitelinks: { enwiki: { title: "Artist", url } } });
    expect((await artistFacts("Q1", { ...opts, fetchImpl: facts(entity("https://en.wikipedia.org/wiki/Artist"), {}, { extract: "Bio." }) }))!.wikipedia)
      .toEqual({ url: "https://en.wikipedia.org/wiki/Artist", extract: "Bio.", imageUrl: null });
    expect((await artistFacts("Q1", { ...opts, fetchImpl: facts(entity(), {}, { extract: "Bio." }) }))!.wikipedia).toBeNull();
    expect((await artistFacts("Q1", { ...opts, fetchImpl: facts(entity("https://x"), {}, {}) }))!.wikipedia).toBeNull();
  });
});

describe("more credits, with Genius set up", () => {
  const details = (id: string, name: string, extra = {}) => ({ id, name, genres: [], tags: [], links: [], lifeSpan: {}, ...extra });
  const env = { GENIUS_ACCESS_TOKEN: " tok " };
  const geniusFor = (names: Record<string, number>, song: unknown = { response: { song: { title: "S" } } }) =>
    fakeWeb((url) => {
      if (url.host !== "api.genius.com") return { releases: [] };
      if (url.pathname === "/search") {
        const id = names[url.searchParams.get("q")!];
        return { response: { hits: id ? [{ result: { primary_artist: { id, name: url.searchParams.get("q") } } }] : [] } };
      }
      if (url.pathname.endsWith("/songs")) return { response: { songs: [{ id: 100, primary_artist: { id: Number(url.pathname.split("/")[2]) } }] } };
      return song;
    });

  it("says Genius has no match when it can't find one of the two", async () => {
    lookups.byId = { [A]: details(A, "Found"), [B]: details(B, "Missing") };
    const result = await moreCredits(A, B, { ...quick, env, fetchImpl: geniusFor({ Found: 1 }) });
    expect(result.sources[0]).toEqual({ source: "Genius", status: "no-match" });
  });

  it("says a Genius scan is partial when a song failed, and reads Discogs without studio titles", async () => {
    lookups.byId = {
      [A]: details(A, "One", { externalIds: { discogs: "1" } }),
      [B]: details(B, "Two", { externalIds: { discogs: "2" }, discography: { studioTitles: ["Album"] } }),
    };
    const result = await moreCredits(A, B, { ...quick, env, fetchImpl: geniusFor({ One: 1, Two: 2 }, status(500)) });
    expect(result.sources[0]).toMatchObject({ source: "Genius", status: "failed" });
    const ok = await moreCredits(A, B, { ...quick, env, fetchImpl: geniusFor({ One: 1, Two: 2 }) });
    expect(ok.sources).toEqual([
      { source: "Genius", status: "ok", scanned: { a: 1, b: 1 }, unit: "songs" },
      { source: "Discogs", status: "ok", scanned: { a: 0, b: 0 }, unit: "albums" },
    ]);
  });

  it("says a scan stopped early is partial, for either source", async () => {
    lookups.byId = { [A]: details(A, "One", { externalIds: { discogs: "1" } }), [B]: details(B, "Two", { externalIds: { discogs: "2" } }) };
    const many = fakeWeb((url) => {
      if (url.host === "api.discogs.com") return url.pathname.endsWith("/releases") ? { releases: [1, 2].map((n) => ({ type: "master", role: "Main", main_release: n })) } : {};
      if (url.pathname === "/search") return { response: { hits: [{ result: { primary_artist: { id: url.searchParams.get("q") === "One" ? 1 : 2, name: url.searchParams.get("q") } } }] } };
      if (url.pathname.endsWith("/songs")) return { response: { songs: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, primary_artist: { id: Number(url.pathname.split("/")[2]) } })) } };
      return { response: { song: { title: "S" } } };
    });
    const result = await moreCredits(A, B, { ...quick, env, budgetMs: -1, fetchImpl: many });
    expect(result.sources.map((s) => s.status)).toEqual(["partial", "partial"]);
  });
});

describe("artist insights from every source", () => {
  const details = (id: string, wikidata?: string) => ({ id, name: id, genres: [], tags: [], links: [], lifeSpan: {}, ...(wikidata ? { externalIds: { wikidata } } : {}) });
  const entity = { claims: { P166: [{ mainsnak: { datavalue: { value: { id: "Q9" } } } }] } };
  const everything = (over: { wikidata?: unknown; lastFm?: unknown } = {}) => fakeWeb((url) => {
    if (url.host === "www.wikidata.org") {
      if (url.searchParams.get("props") === "labels") return { entities: { Q9: { labels: { en: { value: "Award" } } } } };
      return over.wikidata ?? { entities: Object.fromEntries(url.searchParams.get("ids")!.split("|").map((q) => [q, entity])) };
    }
    if (url.host === "ws.audioscrobbler.com") return over.lastFm ?? (url.searchParams.get("method") === "artist.getinfo" ? { artist: { url: "u", stats: { listeners: "5" } } } : { similarartists: { artist: [] } });
    return [];
  });

  it("reports every source as fine, with the facts and awards both artists share", async () => {
    lookups.byId = { [A]: details(A, "Q1"), [B]: details(B, "Q2") };
    const result = await artistInsights(A, B, { ...quick, env: { LASTFM_API_KEY: "k" }, fetchImpl: everything() });
    expect(result.sources.map((s) => s.status)).toEqual(["ok", "ok", "ok"]);
    expect(result.shared.awards).toEqual([{ id: "Q9", name: "Award", year: "" }]);
    expect(result.a.audience.lastFm).toEqual({ listeners: 5, plays: 0, url: "u" });
  });

  it("says which sources failed", async () => {
    lookups.byId = { [A]: details(A, "Q1"), [B]: details(B) };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await artistInsights(A, B, { ...quick, env: { LASTFM_API_KEY: "k" }, fetchImpl: everything({ wikidata: status(500), lastFm: status(500) }) });
    expect(result.sources.map((s) => [s.source, s.status])).toEqual([["Wikidata", "failed"], ["ListenBrainz", "ok"], ["Last.fm", "failed"]]);
    expect(result.shared).toEqual({ awards: [], labels: [], similarArtists: [] });
  });

  it("says Wikidata had no match when only one artist has facts", async () => {
    lookups.byId = { [A]: details(A, "Q1"), [B]: details(B) };
    const result = await artistInsights(A, B, { ...quick, env: {}, fetchImpl: everything() });
    expect(result.sources[0]).toEqual({ source: "Wikidata", status: "no-match" });
    expect(result.b.facts).toBeNull();
  });
});
