// Library and Friend paths on the server: reading listening services, matching to the catalog,
// how artists hang together, and the routes.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as listeningRoute } from "@/app/api/discover/listening/route";
import { GET as nexusRoute } from "@/app/api/discover/nexus/route";
import { heardFrom, ListeningError, matchHeard, TOP } from "../lib/listening";
import { friendPathsOf, nexusOf } from "../lib/nexus";
import { searchCatalog } from "../lib/search";
import { graph } from "../lib/server";
import { connectedIn, isUser, SERVICE_INFO } from "../lib/services";
import { world } from "./world";

const c = graph().catalog;
const idOf = (name: string) => searchCatalog(c, name, ["artist"])[0].id;

/** A fetch answering with this status and body (an object, text that isn't JSON, or nothing). */
const replying = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), { status }));
const failing = vi.fn(async () => {
  throw new TypeError("offline");
});

afterEach(() => vi.unstubAllGlobals());

describe("services", () => {
  it("accept usernames as each service allows them", () => {
    expect(isUser("listenbrainz", "rob_zombie.1")).toBe(true);
    expect(isUser("lastfm", "1abc")).toBe(false);
    expect(isUser("deezer", "123456")).toBe(true);
    expect(isUser("deezer", "abc")).toBe(false);
    expect(SERVICE_INFO.deezer.profile("12")).toBe("https://www.deezer.com/profile/12");
    expect(SERVICE_INFO.lastfm.profile("a b")).toBe("https://www.last.fm/user/a%20b");
    expect(SERVICE_INFO.listenbrainz.profile("rob")).toBe("https://listenbrainz.org/user/rob/");
  });

  it("keep the connected ones that are valid, each once, up to a limit", () => {
    const raw = JSON.stringify([
      { service: "listenbrainz", user: "rob" },
      { service: "listenbrainz", user: "rob" },
      { service: "lastfm", user: "1bad" },
      { service: "myspace", user: "tom" },
      null,
      ...Array.from({ length: 8 }, (_, i) => ({ service: "deezer", user: String(i) })),
    ]);
    const found = connectedIn(raw);
    expect(found[0]).toEqual({ service: "listenbrainz", user: "rob" });
    expect(found).toHaveLength(6);
    for (const bad of [null, "{x", '{"a":1}']) expect(connectedIn(bad)).toEqual([]);
  });
});

describe("reading listening", () => {
  it("reads ListenBrainz's statistics, and says when there are none yet or no such user", async () => {
    const fetchImpl = replying(200, {
      payload: { artists: [{ artist_name: "Adele", artist_mbid: "M1", listen_count: 40 }, { artist_name: "Two", artist_mbids: ["M2"], listen_count: "x" }, { artist_name: "Three" }] },
    });
    expect(await heardFrom("listenbrainz", "rob", {}, fetchImpl)).toEqual([
      { name: "Adele", mbid: "M1", plays: 40 },
      { name: "Two", mbid: "M2", plays: null },
      { name: "Three", mbid: null, plays: null },
    ]);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe(`https://api.listenbrainz.org/1/stats/user/rob/artists?count=${TOP}&range=all_time`);
    expect(await heardFrom("listenbrainz", "rob", {}, replying(204))).toEqual([]);
    expect(await heardFrom("listenbrainz", "rob", {}, replying(200, {}))).toEqual([]);
    await expect(heardFrom("listenbrainz", "rob", {}, replying(404, {}))).rejects.toMatchObject({ status: 404 });
    await expect(heardFrom("listenbrainz", "rob", {}, replying(500, "oops"))).rejects.toMatchObject({ status: 502 });
    await expect(heardFrom("listenbrainz", "rob", {}, failing)).rejects.toMatchObject({ status: 502, message: "The service didn’t answer." });
  });

  it("reads Last.fm with its key, and only with one", async () => {
    const fetchImpl = replying(200, { topartists: { artist: [{ name: "Adele", mbid: "", playcount: "12" }] } });
    expect(await heardFrom("lastfm", "rob", { LASTFM_API_KEY: " k " }, fetchImpl)).toEqual([{ name: "Adele", mbid: null, plays: 12 }]);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain("&api_key=k&");
    await expect(heardFrom("lastfm", "rob", {}, fetchImpl)).rejects.toMatchObject({ status: 503 });
    await expect(heardFrom("lastfm", "rob", { LASTFM_API_KEY: "k" }, replying(404, { error: 6 }))).rejects.toMatchObject({ status: 404 });
    await expect(heardFrom("lastfm", "rob", { LASTFM_API_KEY: "k" }, replying(200, { error: 6 }))).rejects.toMatchObject({ status: 404 });
    await expect(heardFrom("lastfm", "rob", { LASTFM_API_KEY: "k" }, replying(200, { error: 10 }))).rejects.toMatchObject({ status: 502 });
    await expect(heardFrom("lastfm", "rob", { LASTFM_API_KEY: "k" }, replying(500, {}))).rejects.toMatchObject({ status: 502 });
  });

  it("reads a public Deezer profile's artists", async () => {
    expect(await heardFrom("deezer", "12", {}, replying(200, { data: [{ name: "Adele" }, { id: 3 }] }))).toEqual([
      { name: "Adele", mbid: null, plays: null },
      { name: "", mbid: null, plays: null },
    ]);
    await expect(heardFrom("deezer", "12", {}, replying(200, { error: { code: 800 } }))).rejects.toMatchObject({ status: 404 });
    await expect(heardFrom("deezer", "12", {}, replying(200, { error: { code: 4 } }))).rejects.toMatchObject({ status: 502 });
    await expect(heardFrom("deezer", "12", {}, replying(503, {}))).rejects.toBeInstanceOf(ListeningError);
  });

  it("matches artists to the catalog by ID, or else by exact name", () => {
    const adele = idOf("Adele");
    const found = matchHeard(c, [
      { name: "Someone", mbid: adele.toUpperCase(), plays: 3 },
      { name: "taylor swift", mbid: "not-in-catalog", plays: null },
      { name: "Taylor", mbid: null, plays: 1 },
      { name: "", mbid: null, plays: 1 },
    ]);
    expect(found.map((f) => f.artist?.name ?? null)).toEqual(["Adele", "Taylor Swift", null]);
    expect(found[0]).toMatchObject({ name: "Someone", plays: 3 });
  });
});

describe("how artists hang together", () => {
  const g = world({
    artists: ["A", "B", "C", "D", "E", "F"],
    others: ["Hub", "Far", "Hub2", "Hub3"],
    songs: [
      ["ab", 2000, [["A", "primary"], ["B", "featured"]]],
      ["ah", 2001, [["A", "primary"], ["Hub", "featured"]]],
      ["bh", 2002, [["B", "primary"], ["Hub", "featured"]]],
      ["ch", 2003, [["C", "primary"], ["Hub", "featured"]]],
      ["cd", 2004, [["C", "primary"], ["D", "featured"], ["D", "producer"]]],
      ["ef", 2005, [["E", "primary"], ["Far", "featured"]]],
      ["fh", 2006, [["F", "primary"], ["Hub", "featured"]]],
      ...["C", "D"].flatMap((who) => ["Hub2", "Hub3"].map((hub): [string, number, [string, string][]] => [who + hub, 2007, [[who, "primary"], [hub, "featured"]]])),
    ],
  });

  it("finds which of them worked together and the people between them", () => {
    const found = nexusOf(g, [0, 1, 2, 3, 4]);
    expect(found.linked.map((l) => `${l.a.name}-${l.b.name}`)).toEqual(["C-D", "A-B"]);
    // The most connected first; on a tie, the first in the catalog.
    expect(found.between.map((b) => [b.artist.name, b.with.map((a) => a.name)])).toEqual([
      ["Hub", ["A", "B", "C"]],
      ["Hub2", ["C", "D"]],
      ["Hub3", ["C", "D"]],
    ]);
  });

  it("finds the shortest paths between two people's artists, and what they share", () => {
    const found = friendPathsOf(g, [0, 4], [3, 4]);
    expect(found.shared.map((a) => a.name)).toEqual(["E"]);
    expect(found.paths.map((p) => p.artists.map((a) => a.name))).toEqual([["A", "Hub", "C", "D"]]);
    expect(found.paths[0].reasons).toHaveLength(3);
    expect(found.between).toEqual([]);
    const both = friendPathsOf(g, [0, 1], [2]);
    expect(both.paths.map((p) => p.artists.map((a) => a.name))).toEqual([["A", "Hub", "C"], ["B", "Hub", "C"]]);
    expect(both.between.map((b) => b.artist.name)).toEqual(["Hub"]);
    expect(friendPathsOf(g, [4], [4]).between).toEqual([]);
    expect(friendPathsOf(g, [0], [5, 2]).paths.map((p) => p.artists.map((a) => a.name).at(-1))).toEqual(["C", "F"]);
    expect(friendPathsOf(g, [4], [3]).paths).toEqual([]);
  });
});

describe("the routes", () => {
  const listen = async (query: string) => {
    const response = await listeningRoute(new Request(`http://x/api/discover/listening?${query}`));
    return { status: response.status, body: await response.json() };
  };

  it("reads listening and matches it, or says why not", async () => {
    vi.stubGlobal("fetch", replying(200, { payload: { artists: [{ artist_name: "Adele", listen_count: 5 }] } }));
    const found = await listen("service=listenbrainz&user=rob");
    expect([found.status, found.body.artists[0].artist.name]).toEqual([200, "Adele"]);
    vi.stubGlobal("fetch", replying(404, {}));
    expect(await listen("service=listenbrainz&user=rob")).toEqual({ status: 404, body: { error: "ListenBrainz has no user by that name." } });
    expect((await listen("service=myspace&user=rob")).status).toBe(400);
    expect((await listen("service=deezer&user=rob")).status).toBe(400);
    expect((await listen("")).status).toBe(400);
  });

  it("answers the nexus of some artists, or the paths to a friend's", async () => {
    const [adele, drake] = [idOf("Adele"), idOf("Drake")];
    const nexus = await (await nexusRoute(new Request(`http://x/api?artists=${adele},${drake},nope`))).json();
    expect(nexus.artists.map((a: { name: string }) => a.name)).toEqual(["Adele", "Drake"]);
    const paths = await (await nexusRoute(new Request(`http://x/api?artists=${adele}&theirs=${drake}`))).json();
    expect(paths.paths[0].artists[0].name).toBe("Adele");
  });
});
