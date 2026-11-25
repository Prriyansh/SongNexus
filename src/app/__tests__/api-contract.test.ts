// What every API route promises its callers: statuses, bodies, caching and logging, for good input,
// bad input, a busy upstream and a crash. The libraries are replaced, so this is the routes alone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamError, ValidationError } from "@/lib/musicbrainz";

const lib = vi.hoisted(() => ({
  searchMusicBrainz: vi.fn(),
  lookupMusicBrainz: vi.fn(),
  compareCollaborators: vi.fn(),
  artistInsights: vi.fn(),
  moreCredits: vi.fn(),
  similarToArtist: vi.fn(),
  similarToSong: vi.fn(),
  findTopTrack: vi.fn(),
  buildTaste: vi.fn(),
  compareSound: vi.fn(),
  searchSound: vi.fn(),
  store: { current: null as unknown },
}));

vi.mock("@/lib/musicbrainz", async (actual) => ({
  ...(await actual<typeof import("@/lib/musicbrainz")>()),
  searchMusicBrainz: lib.searchMusicBrainz,
  lookupMusicBrainz: lib.lookupMusicBrainz,
  compareCollaborators: lib.compareCollaborators,
}));
vi.mock("@/lib/artist-insights", () => ({ artistInsights: lib.artistInsights }));
vi.mock("@/lib/more-credits", () => ({ moreCredits: lib.moreCredits }));
vi.mock("@/lib/similar", () => ({
  similarToArtist: lib.similarToArtist,
  similarToSong: lib.similarToSong,
}));
vi.mock("@/lib/top-track", () => ({ findTopTrack: lib.findTopTrack }));
vi.mock("@/lib/taste", async (actual) => ({
  ...(await actual<typeof import("@/lib/taste")>()),
  buildTaste: lib.buildTaste,
}));
vi.mock("@/lib/rooms", async (actual) => ({
  ...(await actual<typeof import("@/lib/rooms")>()),
  roomStore: () => lib.store.current,
}));

import * as artistInsightsRoute from "../api/artist-insights/route";
import * as creditsRoute from "../api/credits/route";
import * as collaboratorsRoute from "../api/musicbrainz/collaborators/route";
import * as detailsRoute from "../api/musicbrainz/details/route";
import * as searchRoute from "../api/musicbrainz/search/route";
import * as roomRoute from "../api/rooms/[code]/route";
import * as roomsRoute from "../api/rooms/route";
import * as similarRoute from "../api/similar/route";
import * as tasteRoute from "../api/taste/route";
import * as topTrackRoute from "../api/top-track/route";
import { memoryStore, type RoomStore } from "@/lib/rooms";

const A = "aa000000-0000-4000-8000-000000000001";
const B = "bb000000-0000-4000-8000-000000000002";
const busy = () => new UpstreamError("Catalog busy", 503, true);
const crash = () => new TypeError("boom");
const SONGS = { name: "Sam", songs: [{ title: "Song", artist: "Artist" }] };

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  Object.values(lib).forEach((f) => typeof f === "function" && f.mockReset());
  lib.store.current = memoryStore();
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => log.mockRestore());

const get = async (
  handler: (r: Request) => Promise<Response>,
  query: Partial<Record<string, string>>,
) => {
  const response = await handler(
    new Request(`http://x/api?${new URLSearchParams(query as Record<string, string>)}`),
  );
  return {
    status: response.status,
    body: await response.json(),
    cache: response.headers.get("Cache-Control"),
  };
};
const post = async (
  handler: (r: Request, c: never) => Promise<Response>,
  body: unknown,
  code?: string,
) => {
  const init = { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) };
  const context = { params: Promise.resolve({ code: code ?? "" }) } as never;
  const response = await handler(new Request("http://x/api", init), context);
  return {
    status: response.status,
    body: await response.json(),
    cache: response.headers.get("Cache-Control"),
  };
};

/** The shared failure rules: busy upstream → its status, crash → 500 and a log. */
async function failures(
  call: () => Promise<{ status: number; body: { error: string; retryable?: boolean } }>,
  fn: ReturnType<typeof vi.fn>,
) {
  fn.mockRejectedValueOnce(busy());
  expect(await call()).toMatchObject({
    status: 503,
    body: { error: "Catalog busy", retryable: true },
  });
  fn.mockRejectedValueOnce(crash());
  const crashed = await call();
  expect(crashed.status).toBe(500);
  expect(crashed.body.error).toMatch(/^Something went wrong/);
  expect(crashed.body).not.toHaveProperty("retryable");
  expect(JSON.stringify(crashed.body)).not.toContain("boom"); // never leak the cause
  expect(log).toHaveBeenCalled();
}

describe("GET /api/musicbrainz/search", () => {
  const call = (q: Partial<Record<string, string>>) => get(searchRoute.GET, q);
  it("searches, and lets identical searches be reused for a minute", async () => {
    lib.searchMusicBrainz.mockResolvedValue([{ id: A }]);
    expect(await call({ type: "artist", q: "abba" })).toEqual({
      status: 200,
      body: { results: [{ id: A }] },
      cache: "public, max-age=60",
    });
    expect(lib.searchMusicBrainz).toHaveBeenCalledWith({
      type: "artist",
      query: "abba",
      limit: expect.any(Number),
    });
  });
  it("refuses bad input before asking upstream", async () => {
    for (const q of [
      {},
      { type: "label", q: "abba" },
      { type: "artist", q: "a" },
      { type: "artist", q: "x".repeat(201) },
    ]) {
      expect((await call(q)).status).toBe(400);
    }
    expect(lib.searchMusicBrainz).not.toHaveBeenCalled();
  });
  it("reports upstream trouble and crashes", () =>
    failures(() => call({ type: "artist", q: "abba" }), lib.searchMusicBrainz));
});

describe("GET /api/musicbrainz/details", () => {
  const call = (q: Partial<Record<string, string>>) => get(detailsRoute.GET, q);
  it("looks one thing up, cached for ten minutes", async () => {
    lib.lookupMusicBrainz.mockResolvedValue({ id: A });
    expect(await call({ type: "artist", id: A })).toEqual({
      status: 200,
      body: { details: { id: A } },
      cache: "public, max-age=600",
    });
  });
  it("refuses bad input", async () => {
    for (const q of [{}, { type: "artist", id: "nope" }, { type: "song", id: A }])
      expect((await call(q)).status).toBe(400);
    expect(lib.lookupMusicBrainz).not.toHaveBeenCalled();
  });
  it("reports upstream trouble and crashes", () =>
    failures(() => call({ type: "artist", id: A }), lib.lookupMusicBrainz));
});

describe("GET /api/musicbrainz/collaborators", () => {
  const call = () => get(collaboratorsRoute.GET, { a: A, b: B });
  const coverage = (partial: boolean) => ({ coverage: { a: { partial }, b: { partial: false } } });
  it("caches a full scan and keeps a partial one retryable", async () => {
    lib.compareCollaborators.mockResolvedValue(coverage(false));
    expect((await call()).cache).toBe("public, max-age=600");
    lib.compareCollaborators.mockResolvedValue(coverage(true));
    expect(await call()).toMatchObject({
      status: 200,
      cache: "no-store",
      body: { collaborators: coverage(true) },
    });
  });
  it("refuses one artist twice, or a missing one", async () => {
    expect((await get(collaboratorsRoute.GET, { a: A, b: A })).status).toBe(400);
    expect((await get(collaboratorsRoute.GET, { a: A })).status).toBe(400);
  });
  it("reports upstream trouble and crashes", () => failures(call, lib.compareCollaborators));
  it("has a minute on serverless hosts", () => expect(collaboratorsRoute.maxDuration).toBe(60));
});

describe.each([
  ["artist-insights", artistInsightsRoute, lib.artistInsights, "insights", ["failed"]],
  ["credits", creditsRoute, lib.moreCredits, "credits", ["failed", "partial"]],
] as const)("GET /api/%s", (_, route, fn, key, unsettled) => {
  const call = () => get(route.GET, { a: A, b: B });
  it("caches an hour when every source answered, and not otherwise", async () => {
    fn.mockResolvedValue({ sources: [{ status: "ok" }, { status: "skipped" }] });
    expect(await call()).toMatchObject({
      status: 200,
      cache: "public, max-age=3600",
      body: { [key]: { sources: expect.any(Array) } },
    });
    for (const status of unsettled) {
      fn.mockResolvedValue({ sources: [{ status: "ok" }, { status }] });
      expect((await call()).cache).toBe("no-store");
    }
  });
  it("refuses bad input", async () => {
    expect((await get(route.GET, { a: A })).status).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });
  it("reports upstream trouble and crashes", () => failures(call, fn));
});

describe("GET /api/similar", () => {
  const call = (q: Partial<Record<string, string>>) => get(similarRoute.GET, q);
  const web = (artists: number, songs: number, failed = false) => ({
    artists: Array(artists).fill({}),
    songs: Array(songs).fill({}),
    sources: [{ status: failed ? "failed" : "ok" }],
  });
  it("finds music like an artist, with or without songs, or like a song", async () => {
    lib.similarToArtist.mockResolvedValue(web(2, 2));
    expect(await call({ kind: "artist", id: A })).toMatchObject({
      status: 200,
      cache: "public, max-age=3600",
    });
    expect(lib.similarToArtist).toHaveBeenLastCalledWith(A, {}, { songs: true });
    await call({ kind: "artist", id: A, songs: "0" });
    expect(lib.similarToArtist).toHaveBeenLastCalledWith(A, {}, { songs: false });
    lib.similarToSong.mockResolvedValue(web(1, 1));
    expect((await call({ kind: "song", id: A })).status).toBe(200);
    expect(lib.similarToSong).toHaveBeenCalledWith(A);
  });
  it("doesn’t keep an answer that is missing something", async () => {
    for (const [answer, q] of [
      [web(0, 2), {}],
      [web(2, 0), {}],
      [web(2, 2, true), {}],
    ] as const) {
      lib.similarToArtist.mockResolvedValue(answer);
      expect((await call({ kind: "artist", id: A, ...q })).cache).toBe("no-store");
    }
    lib.similarToArtist.mockResolvedValue(web(2, 0));
    expect((await call({ kind: "artist", id: A, songs: "0" })).cache).toBe("public, max-age=3600");
  });
  it("refuses a bad kind or id", async () => {
    for (const q of [{ kind: "label", id: A }, { kind: "artist", id: "x" }, { id: A }])
      expect((await call(q)).status).toBe(400);
  });
  it("reports upstream trouble and crashes", () =>
    failures(() => call({ kind: "artist", id: A }), lib.similarToArtist));
  it("has a minute on serverless hosts", () => expect(similarRoute.maxDuration).toBe(60));
});

describe("GET /api/top-track", () => {
  const call = (q: Partial<Record<string, string>>) => get(topTrackRoute.GET, q);
  it("finds the top song, cached for an hour, and says when there is none", async () => {
    lib.findTopTrack.mockResolvedValue({ id: B, title: "Hit" });
    expect(await call({ id: A, name: " ABBA " })).toEqual({
      status: 200,
      body: { track: { id: B, title: "Hit" } },
      cache: "public, max-age=3600",
    });
    expect(lib.findTopTrack).toHaveBeenCalledWith({ id: A, name: "ABBA" });
    lib.findTopTrack.mockResolvedValue(null);
    expect((await call({ id: A, name: "ABBA" })).body).toEqual({ track: null });
  });
  it("refuses a bad id or name", async () => {
    for (const q of [
      { id: "x", name: "a" },
      { id: A, name: " " },
      { id: A, name: "x".repeat(201) },
      {},
    ]) {
      expect((await call(q)).status).toBe(400);
    }
  });
  it("reports upstream trouble and crashes", () =>
    failures(() => call({ id: A, name: "ABBA" }), lib.findTopTrack));
});

describe("POST /api/taste", () => {
  it("builds a map without keeping it", async () => {
    lib.buildTaste.mockResolvedValue({ nodes: [] });
    expect(await post(tasteRoute.POST, { mine: SONGS.songs })).toEqual({
      status: 200,
      body: { taste: { nodes: [] } },
      cache: "no-store",
    });
  });
  it("refuses a body that isn’t a playlist", async () => {
    for (const body of ["not json", {}, { mine: [] }, { mine: [{ title: "only a title" }] }]) {
      expect((await post(tasteRoute.POST, body)).status).toBe(400);
    }
    expect(lib.buildTaste).not.toHaveBeenCalled();
  });
  it("reports upstream trouble and crashes", () =>
    failures(() => post(tasteRoute.POST, { mine: SONGS.songs }), lib.buildTaste));
  it("has a minute on serverless hosts", () => expect(tasteRoute.maxDuration).toBe(60));
});

describe("rooms", () => {
  const create = (body: unknown = SONGS) => post(roomsRoute.POST, body);
  const read = async (code: string) => {
    const response = await roomRoute.GET(new Request("http://x"), {
      params: Promise.resolve({ code }),
    } as never);
    return {
      status: response.status,
      body: await response.json(),
      cache: response.headers.get("Cache-Control"),
    };
  };

  it("create a code, read it back in any form, and take one guest", async () => {
    const made = await create();
    expect(made).toMatchObject({ status: 200, cache: "no-store" });
    const code: string = made.body.code;
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    const loose = `${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `;
    expect(await read(loose)).toMatchObject({
      status: 200,
      body: { room: { host: SONGS, guest: null } },
      cache: "no-store",
    });
    const joined = await post(roomRoute.POST, { ...SONGS, name: "Ana" }, code);
    expect(joined).toMatchObject({ status: 200, body: { room: { guest: { name: "Ana" } } } });
    expect(await post(roomRoute.POST, SONGS, code)).toMatchObject({ status: 409 });
  });

  it("don’t exist for codes never made, and say so the same way", async () => {
    const unknown = await read("ZZZZZZ");
    expect(unknown.status).toBe(404);
    expect(await read("not a code!")).toEqual(unknown);
    expect((await post(roomRoute.POST, SONGS, "ZZZZZZ")).status).toBe(404);
  });

  it("refuse a playlist without songs", async () => {
    expect((await create({ name: "x", songs: [] })).status).toBe(400);
    expect((await create("{")).status).toBe(400);
    expect((await post(roomRoute.POST, {}, "ABCDEF")).status).toBe(400);
  });

  it("explain when short codes aren’t set up", async () => {
    lib.store.current = null;
    for (const result of [
      await create(),
      await read("ABCDEF"),
      await post(roomRoute.POST, SONGS, "ABCDEF"),
    ]) {
      expect(result).toMatchObject({ status: 503, body: { unavailable: true } });
    }
  });

  it("are retryable when the store fails, and log it", async () => {
    const broken: RoomStore = {
      setNew: () => Promise.reject(crash()),
      get: () => Promise.reject(crash()),
    };
    lib.store.current = broken;
    for (const result of [
      await create(),
      await read("ABCDEF"),
      await post(roomRoute.POST, SONGS, "ABCDEF"),
    ]) {
      expect(result).toMatchObject({ status: 502, body: { retryable: true } });
    }
    expect(log).toHaveBeenCalledTimes(3);
  });
});

it("every route that waits on others has room to finish", async () => {
  for (const route of [collaboratorsRoute, creditsRoute, similarRoute, tasteRoute])
    expect(route.maxDuration).toBeGreaterThanOrEqual(60);
  expect(ValidationError).toBeDefined();
});
