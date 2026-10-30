import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearCache,
  compareCollaborators,
  compareCredits,
  findRecording,
  indexCredits,
  parseCollaboratorParams,
  releaseRecordings,
  ValidationError,
} from "../musicbrainz";

const A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const PRODUCER = "cccccccc-3333-4333-8333-cccccccccccc";
const MIXER = "dddddddd-4444-4444-8444-dddddddddddd";
const ONLY_A = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
const VARIOUS = "89ad4ac3-39f7-470e-963a-56509c546377";

const person = (id: string, name: string) => ({ id, name });
const rel = (type: string, id: string, name: string) => ({ type, "target-type": "artist", artist: person(id, name) });
const credit = (id: string, name: string) => ({ name, artist: person(id, name) });

// Shapes mirror `release?release-group=…&inc=recordings+artist-credits+recording-level-rels`.
const releaseA = {
  media: [
    {
      tracks: [
        {
          "artist-credit": [credit(A, "Artist A")],
          recording: { id: "ra1", title: "First", relations: [rel("producer", PRODUCER, "Pat Producer"), rel("mix", MIXER, "Max Mixer")] },
        },
        {
          "artist-credit": [credit(A, "Artist A"), credit(B, "Artist B")], // B features on A's song
          recording: { id: "ra2", title: "Duet", relations: [rel("producer", PRODUCER, "Pat Producer"), rel("instrument", ONLY_A, "Solo Player")] },
        },
        {
          "artist-credit": [credit(A, "Artist A"), credit(VARIOUS, "Various Artists")],
          recording: { id: "ra3", title: "Comp", relations: [rel("phonographic copyright", MIXER, "Max Mixer")] }, // not a shown role
        },
      ],
    },
  ],
};
const releaseB = {
  media: [
    {
      tracks: [
        { "artist-credit": [credit(B, "Artist B")], recording: { id: "rb1", title: "Other", relations: [rel("co-producer", PRODUCER, "Pat Producer")] } },
        { "artist-credit": [credit(B, "Artist B")], recording: { id: "rb2", title: "Another", relations: [rel("mix", MIXER, "Max Mixer")] } },
      ],
    },
  ],
};

const index = (release: object, self: string) =>
  indexCredits(releaseRecordings(release), self, { scanned: 1, total: 1, unit: "albums" });

describe("indexCredits", () => {
  const credits = index(releaseA, A);

  it("records each person's roles and tracks, skipping the artist themself", () => {
    expect(credits.people.has(A)).toBe(false);
    expect([...credits.people.get(PRODUCER)!.roles]).toEqual(["producer"]);
    expect([...credits.people.get(PRODUCER)!.tracks.values()]).toEqual(["First", "Duet"]);
    expect([...credits.people.get(B)!.roles]).toEqual(["featured"]);
  });

  it("ignores placeholder artists and roles we don't show", () => {
    expect(credits.people.has(VARIOUS)).toBe(false);
    expect([...credits.people.get(MIXER)!.tracks.keys()]).toEqual(["ra1"]); // copyright credit on ra3 ignored
  });
});

describe("the credits a scan reads", () => {
  const WRITER = "ffffffff-6666-4666-8666-ffffffffffff";
  const track = (id: string, title: string, relations: object[] = []) => ({ "artist-credit": [credit(A, "Artist A")], recording: { id, title, relations } });

  it("applies an album-wide credit to every track", () => {
    const people = index({ relations: [rel("producer", PRODUCER, "Pat Producer")], media: [{ tracks: [track("r1", "One"), track("r2", "Two")] }] }, A).people;
    expect([...people.get(PRODUCER)!.tracks.values()]).toEqual(["One", "Two"]);
  });

  it("reads songwriters from the work a recording performs", () => {
    const performance = { type: "performance", "target-type": "work", work: { relations: [rel("writer", WRITER, "Wren Writer"), rel("publishing", MIXER, "Some Publisher"), rel("composer", A, "Artist A")] } };
    const people = index({ media: [{ tracks: [track("r1", "One", [performance])] }] }, A).people;
    expect([...people.get(WRITER)!.roles]).toEqual(["songwriting"]);
    expect(people.has(MIXER)).toBe(false);
    expect(people.has(A)).toBe(false);
  });

  it("counts a song once when editions hold different recordings of it", () => {
    const edition = (id: string) => ({ media: [{ tracks: [track(id, "One (feat. Someone)", [rel("mix", MIXER, "Max Mixer")])] }] });
    const recordings = [edition("r1"), edition("r2")].flatMap(releaseRecordings);
    const people = indexCredits(recordings, A, { scanned: 1, total: 1, unit: "albums" }).people;
    expect(people.get(MIXER)!.tracks.size).toBe(1);
  });
});

describe("compareCredits", () => {
  const result = compareCredits(index(releaseA, A), index(releaseB, B), A, B);

  it("lists only people credited by both artists, with each side's roles", () => {
    // Both overlap on at least 1 track per side; Pat has more tracks in total, so comes first.
    expect(result.mutual.map((c) => c.name)).toEqual(["Pat Producer", "Max Mixer"]);
    const pat = result.mutual.find((c) => c.id === PRODUCER)!;
    expect(pat.roles).toEqual({ a: ["producer"], b: ["producer"] }); // co-producer counts as producer
    expect(pat.trackCount).toEqual({ a: 2, b: 1 });
    expect(pat.tracks.b).toEqual([{ id: "rb1", title: "Other" }]);
  });

  it("reports direct links between the two artists", () => {
    expect(result.direct).toEqual({ bOnA: [{ id: "ra2", title: "Duet" }], aOnB: [] });
    expect(result.mutual.some((c) => c.id === B)).toBe(false);
  });
});

describe("compareCredits: writing credits", () => {
  const writer = (id: string, name: string) => ({ type: "performance", "target-type": "work", work: { relations: [rel("composer", id, name)] } });
  const track = (id: string, title: string, relations: object[]) => ({ "artist-credit": [credit(A, "Artist A")], recording: { id, title, relations } });

  it("doesn't call a writing credit alone a direct link, but does report it", () => {
    const a = index({ media: [{ tracks: [track("w1", "Borrowed", [writer(B, "Artist B")])] }] }, A);
    const result = compareCredits(a, index({ media: [] }, B), A, B);
    expect(result.direct).toEqual({ bOnA: [], aOnB: [] });
    expect(result.writing).toEqual({ bOnA: [{ id: "w1", title: "Borrowed" }], aOnB: [] });
  });

  it("counts them as direct once they also worked on the track", () => {
    const a = index({ media: [{ tracks: [track("w1", "Together", [writer(B, "Artist B"), rel("vocal", B, "Artist B")])] }] }, A);
    const result = compareCredits(a, index({ media: [] }, B), A, B);
    expect(result.direct.bOnA).toEqual([{ id: "w1", title: "Together" }]);
    expect(result.writing?.bOnA).toEqual([]);
  });
});

describe("parseCollaboratorParams", () => {
  it("accepts two different artist ids", () => {
    expect(parseCollaboratorParams(new URLSearchParams({ a: A, b: B }))).toEqual({ a: A, b: B });
  });
  it("rejects bad or identical ids", () => {
    expect(() => parseCollaboratorParams(new URLSearchParams({ a: "x", b: B }))).toThrow(ValidationError);
    expect(() => parseCollaboratorParams(new URLSearchParams({ a: A, b: A }))).toThrow("Pick two different artists.");
  });
});

type FetchMock = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("compareCollaborators", () => {
  afterEach(() => __clearCache());

  it("reads each artist's most recent studio albums and compares their credits", async () => {
    const albums = (rgs: { id: string; date: string; secondary?: string[] }[]) => ({
      "release-group-count": rgs.length,
      "release-groups": rgs.map((g) => ({ id: g.id, title: g.id, "primary-type": "Album", "secondary-types": g.secondary ?? [], "first-release-date": g.date })),
    });
    const RG = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const fetchImpl = vi.fn<FetchMock>(async (input) => {
      const url = String(input);
      if (url.includes("/release-group?") && url.includes(A)) {
        return ok(albums([{ id: RG(1), date: "2001" }, { id: RG(2), date: "2020", secondary: ["Live"] }]));
      }
      if (url.includes("/release-group?")) return ok(albums([{ id: RG(3), date: "2015" }]));
      if (url.includes(RG(1))) return ok({ releases: [releaseA] });
      if (url.includes(RG(3))) return ok({ releases: [releaseB] });
      throw new Error(`unexpected ${url}`);
    });

    const result = await compareCollaborators({ a: A, b: B }, { fetchImpl, throttleMs: 0, useCache: false });
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(RG(2)))).toBe(false); // live album skipped
    expect(result.coverage.a).toEqual({ scanned: 1, total: 1, unit: "albums" });
    expect(result.mutual.map((c) => c.id).sort()).toEqual([MIXER, PRODUCER].sort());
  });
});

describe("scanning many albums", () => {
  afterEach(() => __clearCache());
  const RG = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const browse = (count: number) => ({
    "release-group-count": count,
    "release-groups": Array.from({ length: count }, (_, i) => ({ id: RG(i), title: `Album ${i}`, "primary-type": "Album", "secondary-types": [], "first-release-date": `20${String(10 + i)}` })),
  });
  const album = { releases: [{ media: [{ tracks: [{ "artist-credit": [credit(A, "Artist A")], recording: { id: "r", title: "Song", relations: [rel("producer", PRODUCER, "Pat Producer")] } }] }] }] };
  const opts = { throttleMs: 0, useCache: false };

  it("reads every studio album, newest first, and asks for several editions with songwriters", async () => {
    const fetchImpl = vi.fn<FetchMock>(async (input) => ok(String(input).includes("/release-group?") ? browse(5) : album));
    const result = await compareCollaborators({ a: A, b: B }, { ...opts, fetchImpl });
    const urls = fetchImpl.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/release?"));
    expect(urls).toHaveLength(10);
    expect(urls[0]).toContain(RG(4));
    expect(urls[0]).toContain("work-level-rels");
    expect(urls[0]).toContain("limit=5");
    expect(result.coverage.a).toEqual({ scanned: 5, total: 5, unit: "albums" });
    expect(result.mutual[0].years).toEqual({ a: { first: "2010", last: "2014" }, b: { first: "2010", last: "2014" } });
  });

  it("reports a partial scan when time runs out, and keeps what it read", async () => {
    const fetchImpl = vi.fn<FetchMock>(async (input) => ok(String(input).includes("/release-group?") ? browse(5) : album));
    const result = await compareCollaborators({ a: A, b: B }, { ...opts, fetchImpl, scanBudgetMs: -1 });
    expect(result.coverage.a).toEqual({ scanned: 1, total: 5, unit: "albums", partial: true });
    expect(result.mutual).toHaveLength(1);
  });

  it("keeps earlier albums when a later one fails", async () => {
    const fetchImpl = vi.fn<FetchMock>(async (input) => {
      const url = String(input);
      if (url.includes("/release-group?")) return ok(browse(3));
      return url.includes(RG(1)) ? ({ ok: false, status: 500 } as Response) : ok(album);
    });
    const result = await compareCollaborators({ a: A, b: B }, { ...opts, fetchImpl });
    expect(result.coverage.a).toEqual({ scanned: 1, total: 3, unit: "albums", partial: true });
  });

  it("fails when not even the first album can be read", async () => {
    const fetchImpl = vi.fn<FetchMock>(async (input) => String(input).includes("/release-group?") ? ok(browse(3)) : ({ ok: false, status: 500 } as Response));
    await expect(compareCollaborators({ a: A, b: B }, { ...opts, fetchImpl })).rejects.toThrow("MusicBrainz returned an error");
  });
});

describe("findRecording", () => {
  afterEach(() => __clearCache());

  it("matches the exact title, ignoring featured-artist suffixes", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () =>
      ok({
        recordings: [
          { id: "r-live", title: "Song Name (live)" },
          { id: "r-studio", title: "Song Name" },
        ],
      })
    );
    const song = await findRecording(A, "Song Name (feat. Someone)", { fetchImpl, throttleMs: 0, useCache: false });
    expect(song?.id).toBe("r-studio");
    expect(decodeURIComponent(String(fetchImpl.mock.calls[0][0]))).toContain(`arid:${A}`);
  });

  it("returns null when nothing matches", async () => {
    const fetchImpl = vi.fn<FetchMock>(async () => ok({ recordings: [{ id: "x", title: "Different" }] }));
    expect(await findRecording(A, "Song Name", { fetchImpl, throttleMs: 0, useCache: false })).toBeNull();
  });
});
