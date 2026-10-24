import { afterEach, describe, expect, it, vi } from "vitest";
import { __clearCache, UpstreamError } from "../musicbrainz";
import { findTopTrack } from "../top-track";

const ARTIST = { id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", name: "Radiohead" };
type FetchMock = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

function deezerAndMb(overrides: { artists?: unknown[]; top?: unknown[]; recordings?: unknown[] } = {}) {
  return vi.fn<FetchMock>(async (input) => {
    const url = String(input);
    if (url.includes("/search/artist")) {
      return ok({
        data: overrides.artists ?? [
          { id: 1, name: "Radiohead Tribute", nb_fan: 999999 },
          { id: 2, name: "radiohead", nb_fan: 5000 },
        ],
      });
    }
    if (url.includes("/artist/2/top")) return ok({ data: overrides.top ?? [{ title: "Creep" }, { title: "Karma Police" }] });
    if (url.includes("musicbrainz.org")) {
      return ok({ recordings: overrides.recordings ?? [{ id: "rec-creep", title: "Creep", "artist-credit": [{ name: "Radiohead" }] }] });
    }
    throw new Error(`unexpected ${url}`);
  });
}

describe("findTopTrack", () => {
  afterEach(() => __clearCache());

  it("uses the exact-name Deezer artist and returns the matched MusicBrainz recording", async () => {
    const fetchImpl = deezerAndMb();
    const track = await findTopTrack(ARTIST, { fetchImpl, throttleMs: 0, useCache: false });
    expect(track).toMatchObject({ id: "rec-creep", title: "Creep", source: "Deezer" });
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("/artist/1/"))).toBe(false); // tribute act ignored
  });

  it("returns null when no Deezer artist has exactly this name", async () => {
    const fetchImpl = deezerAndMb({ artists: [{ id: 1, name: "Radiohead Tribute", nb_fan: 10 }] });
    expect(await findTopTrack(ARTIST, { fetchImpl, throttleMs: 0, useCache: false })).toBeNull();
  });

  it("returns null when none of the top songs exist on MusicBrainz", async () => {
    const fetchImpl = deezerAndMb({ recordings: [] });
    expect(await findTopTrack(ARTIST, { fetchImpl, throttleMs: 0, useCache: false })).toBeNull();
  });

  it("turns a Deezer quota error into a retryable upstream error", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => ok({ error: { type: "Exception", message: "Quota limit exceeded", code: 4 } }));
    await expect(findTopTrack(ARTIST, { fetchImpl, throttleMs: 0, useCache: false })).rejects.toBeInstanceOf(UpstreamError);
  });
});
