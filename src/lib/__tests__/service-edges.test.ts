// The sound service, room storage and Deezer's top tracks with sparse, odd or failing answers,
// and their defaults. sound.test.ts, rooms.test.ts and top-track.test.ts cover the ordinary ones.
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareSound, searchSound } from "../sound";
import { redisStore, roomStore } from "../rooms";
import { findTopTrack } from "../top-track";
import { __clearCache } from "../musicbrainz";
import { fakeWeb, garbled, quick, status } from "./fake-web";

afterEach(() => {
  __clearCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const A = { title: "One", artist: "X" };
const B = { title: "Two", artist: "Y" };
const brief = (id: string) => ({ track: { id, title: id, artists: [], album: null, genre: null, has_lyrics: false } });

describe("the sound service", () => {
  const service = (over: { compare?: unknown; similar?: unknown; match?: unknown } = {}) =>
    fakeWeb((url) => {
      if (url.pathname === "/api/match") return over.match ?? brief(url.searchParams.get("title")!);
      if (url.pathname === "/api/compare") return over.compare ?? { overall: 0.5 };
      if (url.pathname.startsWith("/api/similar/")) return over.similar ?? {};
      if (url.pathname === "/api/search") return { results: [] };
    });

  it("uses the server's address and fetch unless told otherwise", async () => {
    vi.stubEnv("SONG_COMPARE_URL", "http://sound.test/");
    const fetchImpl = service();
    vi.stubGlobal("fetch", fetchImpl);
    expect((await compareSound(A, B)).status).toBe("ok");
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/^http:\/\/sound\.test\/api\/match/);
    expect(await searchSound("one")).toEqual({ status: "ok", results: [] });
  });

  it("has no similar songs when the service lists none", async () => {
    expect(await compareSound(A, B, { baseUrl: "http://s", fetchImpl: service() })).toMatchObject({ status: "ok", similar: { a: [], b: [] } });
  });

  it("is unavailable when the comparison is missing or garbled", async () => {
    expect((await compareSound(A, B, { baseUrl: "http://s", fetchImpl: service({ compare: status(404) }) })).status).toBe("unavailable");
    expect((await compareSound(A, B, { baseUrl: "http://s", fetchImpl: service({ compare: garbled() }) })).status).toBe("unavailable");
  });

  it("treats a refusal of the same song twice as the same track, and any other refusal as unavailable", async () => {
    const refuse = (error: string) => new Response(JSON.stringify({ error }), { status: 400 });
    expect((await compareSound(A, B, { baseUrl: "http://s", fetchImpl: service({ compare: refuse("Pick two different songs.") }) })).status).toBe("same-track");
    expect((await compareSound(A, B, { baseUrl: "http://s", fetchImpl: service({ compare: refuse("Bad id.") }) })).status).toBe("unavailable");
    expect((await compareSound(A, B, { baseUrl: "http://s", fetchImpl: service({ compare: new Response("oops", { status: 400 }) }) })).status).toBe("unavailable");
  });

  it("finds no songs in a search reply without a list", async () => {
    expect(await searchSound("one", 5, { baseUrl: "http://s", fetchImpl: fakeWeb(() => ({ results: "x" })) })).toEqual({ status: "ok", results: [] });
  });
});

describe("room storage on Redis", () => {
  it("reads keys, and says when storage fails", async () => {
    const fetchImpl = fakeWeb((_url, init) => ({ result: JSON.parse(String(init!.body))[1] === "k" ? "v" : null }));
    const store = redisStore("https://redis.test", "t", fetchImpl);
    expect(await store.get("k")).toBe("v");
    expect(await store.get("missing")).toBeNull();
    await expect(redisStore("https://redis.test", "t", fakeWeb(() => status(500))).get("k")).rejects.toThrow("Room storage returned an error (500).");
  });

  it("uses the server's settings and fetch unless told otherwise, and one memory store in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    expect(roomStore()).toBe(roomStore());
    const fetchImpl = fakeWeb(() => ({ result: "OK" }));
    vi.stubGlobal("fetch", fetchImpl);
    expect(await redisStore("https://redis.test", "t").setNew("k", "v", 60)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("Deezer's top tracks", () => {
  const ARTIST = { id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", name: "Band" };
  const deezer = (search: unknown, top: unknown = {}) =>
    fakeWeb((url) => (url.pathname === "/search/artist" ? search : url.pathname.endsWith("/top") ? top : { recordings: [{ id: "rec", title: "Hit" }] }));

  it("says what went wrong when Deezer refuses", async () => {
    await expect(findTopTrack(ARTIST, { ...quick, fetchImpl: deezer(status(500)) })).rejects.toMatchObject({ retryable: true, message: "Deezer returned an error (500)." });
    await expect(findTopTrack(ARTIST, { ...quick, fetchImpl: deezer(status(403)) })).rejects.toMatchObject({ retryable: false });
  });

  it("finds nothing without artists or top songs, and skips songs without a title", async () => {
    expect(await findTopTrack(ARTIST, { ...quick, fetchImpl: deezer({}) })).toBeNull();
    expect(await findTopTrack(ARTIST, { ...quick, fetchImpl: deezer({ data: [{ id: 1, name: "Band" }] }) })).toBeNull();
    const top = { data: [{}, { title: 7 }, { title: "Hit" }] };
    expect(await findTopTrack(ARTIST, { ...quick, fetchImpl: deezer({ data: [{ id: 1, name: "Band" }] }, top) })).toMatchObject({ id: "rec", source: "Deezer" });
  });

  it("picks the most-followed artist of the name, counting a missing count as none", async () => {
    const search = { data: [{ id: 1, name: "Band" }, { id: 2, name: "Band", nb_fan: 3 }, { id: 3, name: "band" }, { name: "Band", nb_fan: 999 }] };
    const fetchImpl = deezer(search, { data: [{ title: "Hit" }] });
    // The one with the most fans has no id, so there's no confident match.
    expect(await findTopTrack(ARTIST, { ...quick, fetchImpl })).toBeNull();
    const fewer = deezer({ data: search.data.slice(0, 3) }, { data: [{ title: "Hit" }] });
    await findTopTrack(ARTIST, { ...quick, fetchImpl: fewer });
    expect(fewer.mock.calls.map(([u]) => String(u))).toContain("https://api.deezer.com/artist/2/top?limit=3");
  });

  it("uses the global fetch unless told otherwise", async () => {
    const fetchImpl = deezer({});
    vi.stubGlobal("fetch", fetchImpl);
    expect(await findTopTrack(ARTIST, { ...quick })).toBeNull();
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe("the rest of rooms and top tracks", () => {
  it("gives up on a room code after a few taken ones", async () => {
    const { createRoom, memoryStore } = await import("../rooms");
    const store = memoryStore();
    const setNew = vi.spyOn(store, "setNew").mockResolvedValue(false);
    await expect(createRoom(store, { name: "Sam", songs: [] }, () => "ABC234")).rejects.toThrow("Could not find a free room code.");
    expect(setNew.mock.calls.length).toBeGreaterThan(1);
  });

  it("says Deezer can't be reached, and finds nothing in a reply that isn't JSON", async () => {
    const ARTIST = { id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", name: "Band" };
    await expect(findTopTrack(ARTIST, { ...quick, fetchImpl: fakeWeb(() => new TypeError("offline")) })).rejects.toMatchObject({ message: "Could not reach Deezer to find top tracks.", retryable: true });
    expect(await findTopTrack(ARTIST, { ...quick, fetchImpl: fakeWeb(() => garbled()) })).toBeNull();
  });
});
