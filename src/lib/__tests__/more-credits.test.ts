import { afterEach, describe, expect, it, vi } from "vitest";
import { __clearCache } from "../musicbrainz";
import { artistInsights } from "../artist-insights";
import { moreCredits } from "../more-credits";

type FetchMock = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const details = (id: string, discogs: string | null) => ({ id, name: `Artist ${id[0]}`, relations: discogs ? [{ url: { resource: `https://www.discogs.com/artist/${discogs}` } }] : [] });
vi.mock("../musicbrainz", async (original) => {
  const actual = await original<typeof import("../musicbrainz")>();
  return { ...actual, lookupMusicBrainz: vi.fn(async ({ id }: { id: string }) => actual.mapArtistDetails(lookups[id])) };
});
let lookups: Record<string, ReturnType<typeof details>> = {};

const listing = (master: number) => ({ releases: [{ type: "master", role: "Main", main_release: master }] });
const release = (id: number, people: object[]) => ({ title: `R${id}`, year: 2020, uri: `https://www.discogs.com/release/${id}`, extraartists: people });
const opts = { useCache: false, throttleMs: 0 };

afterEach(() => { __clearCache(); lookups = {}; });

describe("moreCredits", () => {
  it("finds common people on Discogs and reports Genius as not set up", async () => {
    lookups = { [A]: details(A, "1"), [B]: details(B, "2") };
    const shared = { id: 50, name: "Pat", role: "Producer" };
    const fetchImpl = vi.fn<FetchMock>(async (input) => {
      const url = String(input);
      if (url.includes("/artists/1/")) return ok(listing(11));
      if (url.includes("/artists/2/")) return ok(listing(22));
      if (url.includes("/releases/11")) return ok(release(11, [shared, { id: 2, name: "Artist B", role: "Featuring" }]));
      if (url.includes("/releases/22")) return ok(release(22, [shared]));
      throw new Error(url);
    });
    const result = await moreCredits(A, B, { ...opts, fetchImpl, env: {} });
    expect(result.collaborators.map((p) => p.name)).toEqual(["Pat"]);
    expect(result.direct.map((w) => w.title)).toEqual(["R11"]);
    expect(result.sources).toEqual([
      { source: "Genius", status: "no-key" },
      { source: "Discogs", status: "ok", scanned: { a: 1, b: 1 }, unit: "albums" },
    ]);
  });

  it("won't use Discogs without MusicBrainz's link for both artists", async () => {
    lookups = { [A]: details(A, "1"), [B]: details(B, null) };
    const fetchImpl = vi.fn<FetchMock>();
    const result = await moreCredits(A, B, { ...opts, fetchImpl, env: {} });
    expect(result.sources[1]).toEqual({ source: "Discogs", status: "no-match" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a failing source instead of failing the request", async () => {
    lookups = { [A]: details(A, "1"), [B]: details(B, "2") };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await moreCredits(A, B, { ...opts, env: {}, fetchImpl: vi.fn<FetchMock>(async () => ({ ok: false, status: 500 }) as Response) });
    warn.mockRestore();
    expect(result.sources[1]).toEqual({ source: "Discogs", status: "failed" });
    expect(result.collaborators).toEqual([]);
  });
});

describe("artistInsights", () => {
  it("still answers when ListenBrainz fails, and says Last.fm isn't set up", async () => {
    lookups = { [A]: details(A, null), [B]: details(B, null) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await artistInsights(A, B, { ...opts, env: {}, fetchImpl: vi.fn<FetchMock>(async () => ({ ok: false, status: 503 }) as Response) });
    warn.mockRestore();
    expect(result.sources).toEqual([
      { source: "Wikidata", status: "no-match" },
      { source: "ListenBrainz", status: "failed" },
      { source: "Last.fm", status: "no-key" },
    ]);
    expect(result.a.audience).toEqual({ listenBrainz: null, lastFm: null });
  });
});
