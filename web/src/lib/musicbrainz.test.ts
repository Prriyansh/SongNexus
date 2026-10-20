import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearCache,
  extractResults,
  mapArtist,
  mapRecording,
  parseSearchParams,
  searchMusicBrainz,
  UpstreamError,
  ValidationError,
  type SearchParams,
} from "./musicbrainz";

// Trimmed sample payloads mirroring real MusicBrainz search responses.
const recordingPayload = {
  recordings: [
    {
      id: "rec-1",
      title: "Bohemian Rhapsody",
      length: 354000,
      disambiguation: "remastered",
      "artist-credit": [
        { name: "Queen", artist: { id: "art-q", name: "Queen" } },
      ],
      tags: [
        { count: 5, name: "rock" },
        { count: 0, name: "unvoted" },
        { count: -1, name: "disputed" },
      ],
      releases: [
        { id: "rel-1", title: "A Night at the Opera", date: "1975" },
        { id: "rel-2", title: "", date: "1991" },
      ],
    },
  ],
};

const artistPayload = {
  artists: [
    {
      id: "art-r",
      name: "Radiohead",
      country: "GB",
      type: "Group",
      "life-span": { begin: "1991", ended: false },
      tags: [
        { count: 43, name: "Alternative Rock" },
        { count: 30, name: "art rock" },
        { count: 43, name: "alternative rock" }, // duplicate after lowercasing
      ],
    },
  ],
};

type FetchMock = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const opts = (over: Partial<SearchParams> = {}): SearchParams => ({
  type: "recording",
  query: "test",
  limit: 8,
  ...over,
});

afterEach(() => {
  __clearCache();
  vi.restoreAllMocks();
});

describe("parseSearchParams", () => {
  it("accepts a valid recording search", () => {
    const p = parseSearchParams(new URLSearchParams("type=recording&q=hello"));
    expect(p).toEqual({ type: "recording", query: "hello", limit: 8 });
  });

  it("trims the query and clamps the limit", () => {
    const p = parseSearchParams(
      new URLSearchParams("type=artist&q=%20radiohead%20&limit=999")
    );
    expect(p.query).toBe("radiohead");
    expect(p.limit).toBe(25);
  });

  it("rejects an unknown type", () => {
    expect(() => parseSearchParams(new URLSearchParams("type=album&q=hi"))).toThrow(
      ValidationError
    );
  });

  it("rejects a query that is too short", () => {
    expect(() => parseSearchParams(new URLSearchParams("type=artist&q=a"))).toThrow(
      ValidationError
    );
  });
});

describe("mapRecording", () => {
  it("maps real fields and drops noisy tags", () => {
    const song = mapRecording(recordingPayload.recordings[0]);
    expect(song.id).toBe("rec-1");
    expect(song.durationMs).toBe(354000);
    expect(song.artists).toEqual([{ name: "Queen", id: "art-q" }]);
    expect(song.tags).toEqual(["rock"]); // zero/negative count tags removed
    expect(song.releases).toEqual([
      { id: "rel-1", title: "A Night at the Opera", date: "1975" },
    ]); // untitled release filtered out
  });

  it("handles missing fields without fabricating data", () => {
    const song = mapRecording({ id: "x" });
    expect(song.durationMs).toBeNull();
    expect(song.artists).toEqual([]);
    expect(song.tags).toEqual([]);
    expect(song.releases).toEqual([]);
    expect(song.title).toBe("Untitled recording");
  });
});

describe("mapArtist", () => {
  it("maps fields, sorts tags by votes and dedupes case-insensitively", () => {
    const a = mapArtist(artistPayload.artists[0]);
    expect(a).toMatchObject({ id: "art-r", name: "Radiohead", country: "GB", type: "Group" });
    expect(a.lifeSpan).toEqual({ begin: "1991", end: undefined, ended: false });
    expect(a.tags).toEqual(["alternative rock", "art rock"]);
  });

  it("handles a missing life-span", () => {
    const a = mapArtist({ id: "y", name: "Nobody" });
    expect(a.lifeSpan).toEqual({ begin: undefined, end: undefined, ended: undefined });
  });
});

describe("extractResults", () => {
  it("returns [] for a payload missing the expected key", () => {
    expect(extractResults("recording", {})).toEqual([]);
    expect(extractResults("artist", { artists: null })).toEqual([]);
  });

  it("drops entries without an id", () => {
    expect(extractResults("artist", { artists: [{ name: "No id" }] })).toEqual([]);
  });
});

describe("searchMusicBrainz", () => {
  it("returns mapped results on success and sends an identifiable User-Agent", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => okResponse(artistPayload));
    const results = await searchMusicBrainz(opts({ type: "artist", query: "radiohead" }), {
      fetchImpl,
      throttleMs: 0,
      useCache: false,
    });

    expect(results).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/artist?");
    expect(String(url)).toContain("query=radiohead");
    expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("SongNexus");
  });

  it("encodes special characters in the query safely", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => okResponse({ recordings: [] }));
    await searchMusicBrainz(opts({ query: "AC/DC & Me?" }), {
      fetchImpl,
      throttleMs: 0,
      useCache: false,
    });
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).not.toContain("AC/DC & Me?");
    expect(url).toContain("AC%2FDC");
  });

  it("returns an empty array for no results", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => okResponse({ recordings: [] }));
    const results = await searchMusicBrainz(opts(), {
      fetchImpl,
      throttleMs: 0,
      useCache: false,
    });
    expect(results).toEqual([]);
  });

  it("throws a 503 UpstreamError when rate limited", async () => {
    const fetchImpl = vi.fn<FetchMock>(
      async () =>
        ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response
    );
    await expect(
      searchMusicBrainz(opts(), { fetchImpl, throttleMs: 0, useCache: false })
    ).rejects.toMatchObject({ status: 503 });
  });

  it("throws on a malformed JSON body", async () => {
    const fetchImpl = vi.fn<FetchMock>(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("Unexpected token");
          },
        }) as unknown as Response
    );
    await expect(
      searchMusicBrainz(opts(), { fetchImpl, throttleMs: 0, useCache: false })
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it("maps a network failure to a 502 UpstreamError", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => {
      throw new TypeError("network down");
    });
    await expect(
      searchMusicBrainz(opts(), { fetchImpl, throttleMs: 0, useCache: false })
    ).rejects.toMatchObject({ status: 502 });
  });

  it("serves identical repeat searches from cache without a second fetch", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => okResponse(recordingPayload));
    const args = opts({ query: "queen" });
    await searchMusicBrainz(args, { fetchImpl, throttleMs: 0 });
    await searchMusicBrainz(args, { fetchImpl, throttleMs: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
