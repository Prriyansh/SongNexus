import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearCache,
  coverArtUrl,
  extractResults,
  lookupMusicBrainz,
  mapArtist,
  mapArtistDetails,
  mapRecording,
  mapRecordingDetails,
  parseDetailsParams,
  parseSearchParams,
  searchMusicBrainz,
  UpstreamError,
  ValidationError,
  type DetailsParams,
  type SearchParams,
} from "./musicbrainz";

// --- Sample payloads mirroring real MusicBrainz responses -------------------

const recordingSearch = {
  recordings: [
    {
      id: "rec-1",
      title: "Bohemian Rhapsody",
      length: 354000,
      "artist-credit": [{ name: "Queen", artist: { id: "art-q", name: "Queen" } }],
      tags: [
        { count: 5, name: "rock" },
        { count: 0, name: "unvoted" },
      ],
      releases: [{ id: "rel-1", title: "A Night at the Opera", date: "1975" }],
    },
  ],
};

const artistSearch = {
  artists: [
    {
      id: "art-r",
      name: "Radiohead",
      country: "GB",
      type: "Group",
      "life-span": { begin: "1991", ended: false },
      tags: [{ count: 43, name: "alternative rock" }],
    },
  ],
};

const artistLookup = {
  id: "a74b1b7f-71a5-4011-9441-d0b5e4122711",
  name: "Radiohead",
  disambiguation: "",
  country: "GB",
  type: "Group",
  gender: null,
  "begin-area": { name: "Abingdon-on-Thames" },
  "life-span": { begin: "1991", ended: false, end: null },
  rating: { "votes-count": 80, value: 4.5 },
  genres: [
    { count: 43, name: "Alternative Rock" },
    { count: 30, name: "art rock" },
    { count: 43, name: "alternative rock" }, // dup after lowercasing
  ],
  relations: [
    { type: "official homepage", "target-type": "url", url: { resource: "https://radiohead.com" } },
    { type: "bandcamp", "target-type": "url", url: { resource: "https://radiohead.bandcamp.com" } },
    { type: "wikidata", "target-type": "url", url: { resource: "https://www.wikidata.org/wiki/Q874" } },
    { type: "image", "target-type": "url", url: { resource: "https://example.com/x.jpg" } }, // not in allowlist
    { type: "member of band", "target-type": "artist", artist: { name: "Thom Yorke" } }, // not a url rel
  ],
};

const recordingLookup = {
  id: "95ebc842-9926-4658-8012-12c358247946",
  title: "Paranoid Android",
  length: 383000,
  "artist-credit": [{ name: "Radiohead", artist: { id: "a74b1b7f-71a5-4011-9441-d0b5e4122711", name: "Radiohead" } }],
  "first-release-date": "1997-05-26",
  rating: { "votes-count": 12, value: 5 },
  genres: [{ count: 10, name: "art rock" }],
  releases: [
    { id: "55555555-5555-4555-8555-555555555555", title: "Collection", date: "2010", "release-group": { id: "77777777-7777-4777-8777-777777777777" } },
    { id: "66666666-6666-4666-8666-666666666666", title: "OK Computer", date: "1997-05-21", "release-group": { id: "a5e4bd1a-63c9-4dfc-9e63-ed0c3dc049be" } },
  ],
  relations: [{ type: "youtube", "target-type": "url", url: { resource: "https://youtu.be/x" } }],
};

// --- Test helpers -----------------------------------------------------------

type FetchMock = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const statusResponse = (status: number, retryAfter?: string): Response =>
  ({
    ok: false,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "retry-after" ? retryAfter ?? null : null) },
    json: async () => ({}),
  }) as unknown as Response;

const search = (over: Partial<SearchParams> = {}): SearchParams => ({
  type: "recording",
  query: "test",
  limit: 8,
  ...over,
});

const details = (over: Partial<DetailsParams> = {}): DetailsParams => ({
  type: "artist",
  id: "a74b1b7f-71a5-4011-9441-d0b5e4122711",
  ...over,
});

afterEach(() => {
  __clearCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// --- Validation -------------------------------------------------------------

describe("parseSearchParams", () => {
  it("accepts a valid search and clamps limit", () => {
    const p = parseSearchParams(new URLSearchParams("type=artist&q=%20radiohead%20&limit=999"));
    expect(p).toEqual({ type: "artist", query: "radiohead", limit: 25 });
  });

  it("rejects unknown type and short query", () => {
    expect(() => parseSearchParams(new URLSearchParams("type=album&q=hi"))).toThrow(ValidationError);
    expect(() => parseSearchParams(new URLSearchParams("type=artist&q=a"))).toThrow(ValidationError);
  });
});

describe("parseDetailsParams", () => {
  it("accepts a valid UUID", () => {
    expect(parseDetailsParams(new URLSearchParams(`type=artist&id=${details().id}`))).toEqual(details());
  });

  it("rejects a non-UUID id and bad type", () => {
    expect(() => parseDetailsParams(new URLSearchParams("type=artist&id=not-a-uuid"))).toThrow(ValidationError);
    expect(() => parseDetailsParams(new URLSearchParams("type=album&id=" + details().id))).toThrow(ValidationError);
  });
});

// --- Mappers ----------------------------------------------------------------

describe("search mappers", () => {
  it("maps a recording, dropping noisy tags", () => {
    const song = mapRecording(recordingSearch.recordings[0]);
    expect(song).toMatchObject({ id: "rec-1", durationMs: 354000, tags: ["rock"] });
    expect(song.artists).toEqual([{ name: "Queen", id: "art-q" }]);
  });

  it("maps an artist and handles missing fields", () => {
    expect(mapArtist(artistSearch.artists[0])).toMatchObject({ id: "art-r", country: "GB", tags: ["alternative rock"] });
    expect(mapArtist({ id: "x" }).name).toBe("Unknown artist");
  });
});

// Browse of the artist's album release-groups (`release-group?artist=…&type=album`).
// release-group-count is MusicBrainz's exact total; the page holds at most 100.
const albumBrowse = {
  "release-group-count": 3,
  "release-groups": [
    { id: "a5e4bd1a-63c9-4dfc-9e63-ed0c3dc049be", title: "OK Computer", "primary-type": "Album", "secondary-types": [], "first-release-date": "1997-05-21" },
    { id: "11111111-1111-4111-8111-111111111111", title: "Pablo Honey", "primary-type": "Album", "secondary-types": [], "first-release-date": "1993-02-22" },
    { id: "22222222-2222-4222-8222-222222222222", title: "I Might Be Wrong", "primary-type": "Album", "secondary-types": ["Live"], "first-release-date": "2001-11-12" },
  ],
};

describe("mapArtistDetails", () => {
  const d = () => mapArtistDetails(artistLookup, albumBrowse);

  it("extracts weighted genres (sorted, deduped) and the community rating", () => {
    expect(d().genres.map((g) => g.name)).toEqual(["alternative rock", "art rock"]);
    expect(d().rating).toEqual({ value: 4.5, votes: 80 });
  });

  it("counts all albums and studio albums, with the studio-album year span", () => {
    expect(d().discography).toMatchObject({
      albumCount: 3,
      studioAlbumCount: 2, // the live album isn't a studio album
      complete: true,
      firstYear: "1993",
      lastYear: "1997",
    });
  });

  it("uses MusicBrainz's exact total and flags a partial page", () => {
    // e.g. Metallica: 979 album release-groups (mostly live bootlegs), only 100 per page.
    const disc = mapArtistDetails(artistLookup, { ...albumBrowse, "release-group-count": 979 }).discography;
    expect(disc).toMatchObject({ albumCount: 979, studioAlbumCount: 2, complete: false });
  });

  it("has no discography when the album browse is unavailable", () => {
    expect(mapArtistDetails(artistLookup).discography).toBeNull();
  });

  it("picks studio albums (no secondary types) as representative, with cover art", () => {
    const reps = d().discography!.representative;
    expect(reps.map((r) => r.title)).toEqual(["Pablo Honey", "OK Computer"]); // live album excluded
    expect(reps[1].artUrl).toBe(
      "https://coverartarchive.org/release-group/a5e4bd1a-63c9-4dfc-9e63-ed0c3dc049be/front-250"
    );
  });

  it("keeps only allowlisted url relations", () => {
    expect(d().links.map((l) => l.type)).toEqual(["official homepage", "bandcamp", "wikidata"]);
  });

  it("reads the origin from begin-area when area is absent", () => {
    expect(d().area).toBe("Abingdon-on-Thames");
  });
});

describe("mapRecordingDetails", () => {
  it("maps genres, rating, and the earliest release as representative with art", () => {
    const r = mapRecordingDetails(recordingLookup);
    expect(r.genres.map((g) => g.name)).toEqual(["art rock"]);
    expect(r.rating).toEqual({ value: 5, votes: 12 });
    expect(r.firstReleaseDate).toBe("1997-05-26");
    expect(r.representative).toMatchObject({ title: "OK Computer", year: "1997" }); // earliest, not "Collection"
    expect(r.representative?.artUrl).toBe(
      "https://coverartarchive.org/release/66666666-6666-4666-8666-666666666666/front-250"
    );
  });

  it("returns null representative when there are no releases", () => {
    expect(mapRecordingDetails({ id: "r", title: "x" }).representative).toBeNull();
  });
});

describe("coverArtUrl", () => {
  it("builds a CAA url for a valid id and rejects invalid ids", () => {
    expect(coverArtUrl("release-group", "a5e4bd1a-63c9-4dfc-9e63-ed0c3dc049be")).toContain("/release-group/");
    expect(coverArtUrl("release", "nope")).toBeNull();
  });
});

describe("extractResults", () => {
  it("returns [] for missing keys and drops id-less entries", () => {
    expect(extractResults("recording", {})).toEqual([]);
    expect(extractResults("artist", { artists: [{ name: "No id" }] })).toEqual([]);
  });
});

// --- Request behaviour: search / lookup / dedup / backoff / SWR -------------

describe("searchMusicBrainz", () => {
  it("returns mapped results and sends an identifiable User-Agent", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => okResponse(artistSearch));
    const results = await searchMusicBrainz(search({ type: "artist", query: "radiohead" }), {
      fetchImpl,
      throttleMs: 0,
      useCache: false,
    });
    expect(results).toHaveLength(1);
    const init = fetchImpl.mock.calls[0][1];
    expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("SongNexus");
  });

  it("encodes special characters safely", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => okResponse({ recordings: [] }));
    await searchMusicBrainz(search({ query: "AC/DC & Me?" }), { fetchImpl, throttleMs: 0, useCache: false });
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("AC%2FDC");
    expect(url).not.toContain("AC/DC & Me?");
  });

  it("returns an empty array for no results", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => okResponse({ recordings: [] }));
    expect(await searchMusicBrainz(search(), { fetchImpl, throttleMs: 0, useCache: false })).toEqual([]);
  });

  it("throws a retryable 502 on malformed JSON", async () => {
    const fetchImpl = vi.fn<FetchMock>(
      async () =>
        ({ ok: true, status: 200, json: async () => { throw new Error("bad"); } }) as unknown as Response
    );
    await expect(
      searchMusicBrainz(search(), { fetchImpl, throttleMs: 0, useCache: false })
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it("serves a repeated search from cache without a second fetch", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => okResponse(recordingSearch));
    const args = search({ query: "queen" });
    await searchMusicBrainz(args, { fetchImpl, throttleMs: 0 });
    await searchMusicBrainz(args, { fetchImpl, throttleMs: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent identical requests into one upstream call", async () => {
    let resolve!: (r: Response) => void;
    const pending = new Promise<Response>((r) => (resolve = r));
    const fetchImpl = vi.fn<FetchMock>(() => pending);
    const args = search({ query: "dedupe" });
    const both = Promise.all([
      searchMusicBrainz(args, { fetchImpl, throttleMs: 0 }),
      searchMusicBrainz(args, { fetchImpl, throttleMs: 0 }),
    ]);
    resolve(okResponse(recordingSearch));
    const [a, b] = await both;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
});

describe("rate-limit resilience", () => {
  it("retries after a 503 and then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn<FetchMock>(async () => (n++ === 0 ? statusResponse(503) : okResponse(recordingSearch)));
    const results = await searchMusicBrainz(search(), { fetchImpl, throttleMs: 0, retryBaseMs: 0, useCache: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
  });

  it("gives up after the retry limit with a retryable 503", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => statusResponse(503));
    await expect(
      searchMusicBrainz(search(), { fetchImpl, throttleMs: 0, retryBaseMs: 0, maxRetries: 2, useCache: false })
    ).rejects.toMatchObject({ status: 503, retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("honors a Retry-After header before retrying", async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetchImpl = vi.fn<FetchMock>(async () =>
      n++ === 0 ? statusResponse(503, "2") : okResponse(recordingSearch)
    );
    const promise = searchMusicBrainz(search(), {
      fetchImpl,
      throttleMs: 0,
      maxRetries: 1,
      useCache: false,
    });
    // Before the 2s Retry-After elapses, the retry has not fired yet.
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-rate-limit error (404)", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => statusResponse(404));
    await expect(
      searchMusicBrainz(search(), { fetchImpl, throttleMs: 0, retryBaseMs: 0, useCache: false })
    ).rejects.toMatchObject({ status: 502, retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("serves stale cached data when a refresh hits a 503 (stale-while-revalidate)", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<FetchMock>(async () => okResponse(recordingSearch));
    const args = search({ query: "swr" });
    const fresh = await searchMusicBrainz(args, { fetchImpl, throttleMs: 0, maxRetries: 0 });

    vi.advanceTimersByTime(6 * 60_000); // past the 5-min fresh window, within stale window
    fetchImpl.mockImplementation(async () => statusResponse(503));
    const stale = await searchMusicBrainz(args, { fetchImpl, throttleMs: 0, maxRetries: 0 });

    expect(stale).toEqual(fresh); // old data returned instead of an error
  });
});

describe("lookupMusicBrainz", () => {
  it("returns enriched artist details from a lookup plus an album browse", async () => {
    const fetchImpl = vi.fn<FetchMock>(async (url) =>
      okResponse(String(url).includes("/release-group?") ? albumBrowse : artistLookup)
    );
    const result = await lookupMusicBrainz(details(), { fetchImpl, throttleMs: 0, useCache: false });
    const [lookupUrl, browseUrl] = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(lookupUrl).toContain("/artist/");
    expect(lookupUrl).toContain("inc=genres");
    expect(lookupUrl).not.toContain("release-groups"); // capped at 25 on lookups
    expect(browseUrl).toContain("type=album");
    expect(browseUrl).toContain("limit=100");
    expect("discography" in result && result.discography?.studioAlbumCount).toBe(2);
  });

  it("still returns the artist when only the album browse fails", async () => {
    const fetchImpl = vi.fn<FetchMock>(async (url) =>
      String(url).includes("/release-group?") ? statusResponse(500) : okResponse(artistLookup)
    );
    const result = await lookupMusicBrainz(details(), { fetchImpl, throttleMs: 0, retryBaseMs: 0, useCache: false });
    expect("name" in result && result.name).toBe("Radiohead");
    expect("discography" in result && result.discography).toBeNull();
  });

  it("returns enriched recording details", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => okResponse(recordingLookup));
    const result = await lookupMusicBrainz(details({ type: "recording" }), { fetchImpl, throttleMs: 0, useCache: false });
    expect("title" in result && result.title).toBe("Paranoid Android");
  });
});
