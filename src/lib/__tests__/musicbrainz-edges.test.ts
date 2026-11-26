// musicbrainz.ts with sparse or odd payloads, and the request paths the ordinary tests skip: the
// real throttle, timeouts, Retry-After headers MusicBrainz didn't format, artists without studio
// albums. musicbrainz.test.ts and collaborators.test.ts cover the ordinary answers.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearCache,
  compareCollaborators,
  compareCredits,
  findRecordings,
  indexCredits,
  lookupMusicBrainz,
  mapArtistDetails,
  mapDiscography,
  mapRecording,
  mapRecordingDetails,
  parseCollaboratorParams,
  parseDetailsParams,
  parseSearchParams,
  releaseRecordings,
  searchMusicBrainz,
  UpstreamError,
  ValidationError,
  withCache,
} from "../musicbrainz";
import { asked, fakeWeb, quick, status } from "./fake-web";

afterEach(() => {
  __clearCache();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const P = "cccccccc-3333-4333-8333-cccccccccccc";
const ALBUM = "dddddddd-4444-4444-8444-dddddddddddd";
const params = (q: Record<string, string>) => new URLSearchParams(q);
const coverage = { scanned: 1, total: 1, unit: "albums" as const };

describe("reading request parameters", () => {
  it("treats a missing parameter as empty", () => {
    expect(() => parseSearchParams(params({ type: "artist" }))).toThrow("at least");
    expect(() => parseCollaboratorParams(params({}))).toThrow(ValidationError);
    expect(() => parseCollaboratorParams(params({ a: A }))).toThrow(ValidationError);
    expect(() => parseDetailsParams(params({ type: "artist" }))).toThrow('"id"');
  });

  it("rejects an overlong query, and ignores a limit that isn't a number", () => {
    expect(() => parseSearchParams(params({ type: "artist", q: "x".repeat(201) }))).toThrow("at most 200");
    expect(parseSearchParams(params({ type: "artist", q: "radiohead", limit: "lots" })).limit).toBe(parseSearchParams(params({ type: "artist", q: "radiohead" })).limit);
  });

  it("needs two different artists, whatever their case", () => {
    expect(() => parseCollaboratorParams(params({ a: A, b: A.toUpperCase() }))).toThrow("two different");
    expect(parseCollaboratorParams(params({ a: ` ${A} `, b: B }))).toEqual({ a: A, b: B });
  });
});

describe("mapping sparse payloads", () => {
  it("names an untitled recording, and drops tags without a count", () => {
    expect(mapRecording({ tags: [{ name: "rock", count: "5" as never }, { name: "pop", count: 2 }] })).toMatchObject({ id: "", title: "Untitled recording", tags: ["pop"] });
  });

  it("has no rating without a value or a vote", () => {
    expect(mapArtistDetails({ id: A, name: "X", rating: { value: "4" as never, "votes-count": 3 } }).rating).toBeNull();
    expect(mapArtistDetails({ id: A, name: "X", rating: { value: 4 } }).rating).toBeNull();
    expect(mapArtistDetails({ id: A, name: "X", rating: { value: 4, "votes-count": 0 } }).rating).toBeNull();
  });

  it("keeps at most six links, one of each kind", () => {
    const kinds = ["official homepage", "streaming", "bandcamp", "youtube", "soundcloud", "discogs", "allmusic"];
    const relations = kinds.map((type, i) => ({ "target-type": "url", type, url: { resource: `https://example.com/${i}` } }));
    expect(mapArtistDetails({ id: A, name: "X", relations }).links.map((l) => l.type)).toEqual(kinds.slice(0, 6));
  });

  it("counts albums without a total, and dates a discography from any album when none is a studio one", () => {
    const live = { id: ALBUM, title: "Live", "primary-type": "Album", "secondary-types": ["Live"], "first-release-date": "2001-05-01" };
    expect(mapDiscography({ "release-groups": [live] })).toEqual({
      albumCount: 1, studioAlbumCount: 0, complete: true, firstYear: "2001", lastYear: "2001", representative: [],
    });
  });

  it("has no years for undated albums", () => {
    const undated = { id: ALBUM, title: "Untimed", "primary-type": "Album" };
    expect(mapDiscography({ "release-groups": [undated] })).toMatchObject({ firstYear: "", lastYear: "", studioTitles: ["Untimed"] });
  });

  it("puts undated releases after dated ones when choosing a song's representative", () => {
    const details = mapRecordingDetails({ id: A, title: "Song", releases: [{ id: "r1", title: "Undated" }, { id: "r2", title: "Dated", date: "2020" }, { id: "r3", title: "Also undated" }] });
    expect(details.representative?.title).toBe("Dated");
  });
});

describe("credits from sparse recordings", () => {
  it("skips recordings without an id and copes without credits, relations or a title", () => {
    const index = indexCredits(
      [{ title: "No id" } as never, { id: "r1", "artist-credit": "x" as never, relations: "y" as never }, { id: "r2", relations: [{ type: "producer", artist: { id: P, name: "Producer" } }] }],
      A,
      coverage,
    );
    expect([...index.people.get(P)!.tracks.values()]).toEqual(["Untitled recording"]);
  });

  it("reads a release's tracks, and the album's own credits on each", () => {
    const recordings = releaseRecordings({
      relations: [{ type: "producer", artist: { id: P, name: "Producer" } }, { type: "url" }],
      media: [{}, { tracks: [{}, { recording: { id: "r1", title: "One", "artist-credit": [{ artist: { id: A, name: "A" } }] } }, { "artist-credit": [], recording: { id: "r2" } }] }],
    });
    expect(recordings.map((r) => [r.id, r["artist-credit"]?.length, r.relations?.length])).toEqual([["r1", 1, 1], ["r2", 0, 1]]);
    expect(releaseRecordings(null)).toEqual([]);
    expect(releaseRecordings({})).toEqual([]);
  });

  it("orders collaborators with the same overlap by name", () => {
    const person = (name: string) => ({ name, roles: new Set(["mixing"]), tracks: new Map([["t", "T"]]), worked: new Map(), titles: new Set(["t"]), years: new Set<string>() });
    const index = (ids: string[]) => ({ coverage, people: new Map(ids.map((id) => [id, person(id === "x" ? "Zed" : "Amy")])) });
    expect(compareCredits(index(["x", "y"]), index(["x", "y"]), A, B).mutual.map((m) => m.name)).toEqual(["Amy", "Zed"]);
  });
});

describe("the request core", () => {
  it("spaces requests out when throttled", async () => {
    const at: number[] = [];
    const fetchImpl = fakeWeb(() => { at.push(Date.now()); return { artists: [] }; });
    await searchMusicBrainz({ type: "artist", query: "one", limit: 5 }, { fetchImpl, throttleMs: 300, useCache: false });
    await searchMusicBrainz({ type: "artist", query: "two", limit: 5 }, { fetchImpl, throttleMs: 300, useCache: false });
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(290);
  });

  it("gives up on a request after ten seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const pending = searchMusicBrainz({ type: "artist", query: "never", limit: 5 }, { ...quick, maxRetries: 0, fetchImpl }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ status: 504, message: "MusicBrainz request timed out." });
  });

  it("finds no artists in a reply without a list of them", async () => {
    await expect(searchMusicBrainz({ type: "artist", query: "nobody", limit: 5 }, { ...quick, fetchImpl: fakeWeb(() => null) })).resolves.toEqual([]);
    await expect(searchMusicBrainz({ type: "artist", query: "nothing", limit: 5 }, { ...quick, fetchImpl: fakeWeb(() => ({ artists: "x" })) })).resolves.toEqual([]);
  });

  it("says a request timed out when it was aborted, and that MusicBrainz is unreachable otherwise", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const timedOut = await searchMusicBrainz({ type: "artist", query: "slow", limit: 5 }, { ...quick, maxRetries: 0, fetchImpl: fakeWeb(() => abort) }).catch((e: unknown) => e);
    expect(timedOut).toMatchObject({ status: 504, retryable: true, message: "MusicBrainz request timed out." });
    const thrown = await searchMusicBrainz({ type: "artist", query: "gone", limit: 5 }, {
      ...quick,
      maxRetries: 0,
      fetchImpl: vi.fn(() => Promise.reject("socket hang up")),
    }).catch((e: unknown) => e);
    expect(thrown).toMatchObject({ status: 502, message: "Could not reach MusicBrainz." });
  });

  it("ignores a Retry-After header it can't read", async () => {
    let calls = 0;
    const busy = (value: string) => new Response("{}", { status: 503, headers: { "Retry-After": value } });
    const fetchImpl = vi.fn(async () => (calls++ === 0 ? busy("soon") : calls === 2 ? busy("-5") : new Response(JSON.stringify({ artists: [] }))));
    await expect(searchMusicBrainz({ type: "artist", query: "busy", limit: 5 }, { ...quick, maxRetries: 2, fetchImpl })).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("caches by default, and passes on a failure when there's nothing stale to serve", async () => {
    let n = 0;
    const once = () => withCache("edge:counter", 60_000, undefined, async () => ++n);
    expect([await once(), await once()]).toEqual([1, 1]);
    await expect(withCache("edge:fails", 60_000, true, async () => { throw new UpstreamError("busy", 503, true); })).rejects.toThrow("busy");
  });
});

describe("collaborators of artists without studio albums", () => {
  const recording = (id: string) => ({ id, title: id, relations: [{ type: "mix", artist: { id: P, name: "Mixer" } }] });
  const browse = (artist: string) => (artist === A ? {} : { "release-groups": [{ id: "not-a-uuid", "primary-type": "Album" }, { id: ALBUM, "primary-type": "EP" }] });

  it("reads one page of their recordings instead, saying how many there are", async () => {
    const fetchImpl = fakeWeb((url) => {
      if (url.pathname === "/ws/2/release-group") return browse(url.searchParams.get("artist")!);
      if (url.pathname === "/ws/2/recording") return url.searchParams.get("artist") === A ? { recordings: [recording("r1")], "recording-count": 40 } : { recordings: "none" };
    });
    const result = await compareCollaborators({ a: A, b: B }, { ...quick, fetchImpl });
    expect(result.coverage).toEqual({ a: { scanned: 1, total: 40, unit: "recordings" }, b: { scanned: 0, total: 0, unit: "recordings" } });
    expect(asked(fetchImpl).filter((u) => u.includes("/recording?"))).toHaveLength(2);
  });

  it("reads an album's editions, keeping songwriting credits and nothing else from its works", async () => {
    const studio = { "release-groups": [{ id: ALBUM, title: "Album", "primary-type": "Album", "first-release-date": "2020" }] };
    const release = {
      media: [{ tracks: [{ recording: {
        id: "r1", title: "Song",
        relations: [
          { type: "performance", work: { relations: [{ type: "lyricist", artist: { id: P, name: "Writer" } }, { type: "arranger", artist: { id: B, name: "Arranger" } }] } },
          { type: "performance", work: { relations: [{ type: "arranger", artist: { id: B, name: "Arranger" } }] } },
          { type: "url" },
        ],
      } }] }],
    };
    const fetchImpl = fakeWeb((url) => {
      if (url.pathname === "/ws/2/release-group") return url.searchParams.get("artist") === A ? studio : {};
      if (url.pathname === "/ws/2/release") return url.searchParams.get("release-group") === ALBUM ? { releases: [release] } : {};
      if (url.pathname === "/ws/2/recording") return { recordings: [{ id: "x", relations: [{ type: "performance", work: { relations: [{ type: "lyricist", artist: { id: P, name: "Writer" } }] } }] }] };
    });
    const result = await compareCollaborators({ a: A, b: B }, { ...quick, fetchImpl });
    expect(result.mutual.map((m) => [m.name, m.roles.a])).toEqual([["Writer", ["songwriting"]]]);
  });

  it("reads nothing for an album page without releases", async () => {
    const studio = { "release-groups": [{ id: ALBUM, title: "Album", "primary-type": "Album" }] };
    const fetchImpl = fakeWeb((url) => (url.pathname === "/ws/2/release-group" ? studio : {}));
    const result = await compareCollaborators({ a: A, b: B }, { ...quick, fetchImpl });
    expect(result.coverage.a).toEqual({ scanned: 1, total: 1, unit: "albums" });
    expect(result.mutual).toEqual([]);
  });
});

describe("finding a recording by title", () => {
  it("asks nothing for a bad artist id or a title that's only a feature credit", async () => {
    const fetchImpl = fakeWeb(() => ({ recordings: [] }));
    expect(await findRecordings("not-an-id", "Song", { ...quick, fetchImpl })).toEqual([]);
    expect(await findRecordings(A, " (feat. Someone) ", { ...quick, fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("looking up details", () => {
  it("logs an album browse that fails, with the reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = fakeWeb((url) => (url.pathname === "/ws/2/release-group" ? status(404) : { id: A, name: "Artist" }));
    const details = await lookupMusicBrainz({ type: "artist", id: A }, { ...quick, fetchImpl });
    expect(warn).toHaveBeenCalledWith(`[musicbrainz] album browse failed for ${A}: MusicBrainz returned an error (404).`);
    expect("discography" in details && details.discography).toBeNull();
  });
});
