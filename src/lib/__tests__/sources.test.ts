import { afterEach, describe, expect, it, vi } from "vitest";
import { __clearCache } from "../musicbrainz";
import { commonPeople, creditRole, normalizeName } from "../credit-sources";
import { discogsCredits } from "../discogs";
import { geniusCredits } from "../genius";
import { artistFacts } from "../wikidata";
import { commonsPhoto, isFreeLicense, plainText } from "../commons";
import { listenBrainzAudience } from "../listenbrainz";
import { lastFmAudience, lastFmSimilar } from "../lastfm";
import { sharedEntries, sharedSimilar } from "../artist-insights";

type FetchMock = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) }) as unknown as Response;
/** Answers by the first url fragment that matches; anything else is a test bug. */
const routes = (table: Record<string, unknown>) => vi.fn<FetchMock>(async (input) => {
  const url = String(input);
  const key = Object.keys(table).find((k) => url.includes(k));
  if (!key) throw new Error(`unexpected ${url}`);
  return table[key] instanceof Object && "ok" in (table[key] as object) ? (table[key] as Response) : ok(table[key]);
});

afterEach(() => __clearCache());

describe("creditRole", () => {
  it.each([
    ["Producer", "producer"], ["Producer [Additional]", "producer"], ["Mixed By", "mixing"], ["Engineer [Mixing Engineer]", "mixing"],
    ["Written-By", "songwriting"], ["Composed By", "songwriting"], ["Lyrics By", "songwriting"], ["Engineer [Recording Engineer]", "engineering"],
    ["Featuring", "featured"], ["Backing Vocals", "vocals"], ["Acoustic Guitar", "instruments"], ["Programmed By", "programming"],
  ])("%s is %s", (label, role) => expect(creditRole(label)).toBe(role));

  it.each(["Engineer [Mastering Engineer]", "Design", "Photography By", "Label", "Recorded At", "Mixed At", "Phonographic Copyright", "Publisher", "Arranged By"])(
    "%s isn't shown", (label) => expect(creditRole(label)).toBeNull());
});

describe("normalizeName", () => {
  it("ignores case, accents and punctuation but keeps other scripts", () => {
    expect(normalizeName("Beyoncé")).toBe(normalizeName("BEYONCE"));
    expect(normalizeName("Jack  Antonoff")).toBe("jackantonoff");
    expect(normalizeName("米津玄師")).toBe("米津玄師");
    expect(normalizeName("米津玄師")).not.toBe(normalizeName("椎名林檎"));
  });
});

describe("commonPeople", () => {
  const person = (name: string, work: string) => ({ name, url: `u/${name}`, roles: new Set(["producer"]), work: new Map([[work, { title: work, url: work, year: "2020" }]]) });
  it("matches by id, so two people sharing a name stay apart, and leaves out the artists", () => {
    const a = new Map([["1", person("John Smith", "w1")], ["9", person("Artist B", "w2")], ["3", person("Pat", "w3")]]);
    const b = new Map([["2", person("John Smith", "w4")], ["9", person("Artist B", "w5")], ["3", person("Pat", "w6")]]);
    expect(commonPeople("discogs", a, b, ["9"]).map((p) => p.id)).toEqual(["3"]);
  });
});

describe("discogsCredits", () => {
  const listing = { releases: [
    { type: "release", role: "Main", id: 1 },
    { type: "master", role: "Appearance", main_release: 2 },
    { type: "master", role: "Main", main_release: 3, year: 2021 },
  ] };
  const release = { title: "SOUR", year: 2021, uri: "https://www.discogs.com/release/3", extraartists: [{ id: 10, name: "Dan Nigro (2)", role: "Producer" }, { id: 11, name: "Sleeve Person", role: "Design" }], tracklist: [{ extraartists: [{ id: 12, name: "Mitch McCarthy", role: "Mixed By" }] }] };

  it("reads the main release of the artist's own masters, album and track credits alike", async () => {
    const fetchImpl = routes({ "/artists/7/releases": listing, "/releases/3": release });
    const { people, scanned, complete } = await discogsCredits("7", [], { fetchImpl, useCache: false, throttleMs: 0, env: {} });
    expect([scanned, complete]).toEqual([1, true]);
    expect(people.get("10")).toMatchObject({ name: "Dan Nigro", url: "https://www.discogs.com/artist/10" });
    expect([...people.get("12")!.roles]).toEqual(["mixing"]);
    expect(people.has("11")).toBe(false);
  });

  it("reads studio albums before singles, whatever the year", async () => {
    const mixed = { releases: [
      { type: "master", role: "Main", title: "A Single", main_release: 8, year: 2026 },
      { type: "master", role: "Main", title: "SOUR", main_release: 3, year: 2021 },
    ] };
    const fetchImpl = routes({ "/artists/7/releases": mixed, "/releases/3": release, "/releases/8": release });
    await discogsCredits("7", ["Sour"], { fetchImpl, useCache: false, throttleMs: 0, env: {} });
    expect(String(fetchImpl.mock.calls[1][0])).toContain("/releases/3");
  });

  it("sends the token only when there is one", async () => {
    const fetchImpl = routes({ "/artists/7/releases": { releases: [] } });
    await discogsCredits("7", [], { fetchImpl, useCache: false, env: { DISCOGS_TOKEN: "t0k" } });
    expect((fetchImpl.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe("Discogs token=t0k");
    fetchImpl.mockClear();
    await discogsCredits("7", [], { fetchImpl, useCache: false, env: {} });
    expect((fetchImpl.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("says it stopped early when time runs out", async () => {
    const two = { releases: [{ type: "master", role: "Main", main_release: 3 }, { type: "master", role: "Main", main_release: 4 }] };
    const fetchImpl = routes({ "/artists/7/releases": two, "/releases/3": release });
    const result = await discogsCredits("7", [], { fetchImpl, useCache: false, throttleMs: 0, budgetMs: -1, env: {} });
    expect([result.scanned, result.complete]).toEqual([1, false]);
  });
});

describe("geniusCredits", () => {
  const self = { id: 5, name: "Olivia Rodrigo", url: "https://genius.com/artists/Olivia-rodrigo" };
  const other = { id: 6, name: "Olivia Rodrigo Tribute", url: "https://genius.com/artists/Olivia-rodrigo-tribute" };
  const search = (...artists: object[]) => ({ response: { hits: artists.map((primary_artist) => ({ result: { primary_artist } })) } });
  const opts = { useCache: false, env: {} };
  const song = { response: { song: { title: "vampire", url: "https://genius.com/vampire", release_date: "2023-06-30",
    producer_artists: [{ id: 20, name: "Dan Nigro", url: "https://genius.com/artists/Dan-nigro" }],
    writer_artists: [self, { id: 21, name: "Amy Allen", url: "u" }],
    featured_artists: [],
    custom_performances: [{ label: "Mixing Engineer", artists: [{ id: 22, name: "Mitch", url: "u" }] }, { label: "Label", artists: [{ id: 23, name: "Geffen", url: "u" }] }, { label: "Recorded At", artists: [{ id: 24, name: "A Studio", url: "u" }] }] } } };

  it("reads producers, writers and performers of the artist's own songs, and never itself", async () => {
    const fetchImpl = routes({ "/search": search(self), "/artists/5/songs": { response: { songs: [{ id: 100, primary_artist: self }, { id: 101, primary_artist: other }] } }, "/songs/100": song });
    const result = await geniusCredits({ name: "Olivia Rodrigo" }, "tok", { ...opts, fetchImpl });
    expect(result?.scanned).toBe(1);
    expect([...result!.people.keys()].sort()).toEqual(["20", "21", "22"]);
    expect([...result!.people.get("20")!.roles]).toEqual(["producer"]);
    expect([...result!.people.get("22")!.roles]).toEqual(["mixing"]);
    expect(fetchImpl.mock.calls[0][1]!.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("/songs/101"))).toBe(false);
  });

  it("rejects a near-name match rather than guessing", async () => {
    const fetchImpl = routes({ "/search": search(other) });
    expect(await geniusCredits({ name: "Olivia Rodrigo" }, "tok", { ...opts, fetchImpl })).toBeNull();
  });

  it("prefers MusicBrainz's link, and an exact name doesn't override it", async () => {
    const fetchImpl = routes({ "/search": search(self) });
    expect(await geniusCredits({ name: "Olivia Rodrigo", slug: "Someone-else" }, "tok", { ...opts, fetchImpl })).toBeNull();
  });

  it("says it's incomplete when some songs fail", async () => {
    const fetchImpl = routes({ "/search": search(self), "/artists/5/songs": { response: { songs: [{ id: 100, primary_artist: self }, { id: 102, primary_artist: self }] } }, "/songs/100": song, "/songs/102": fail(500) });
    const result = await geniusCredits({ name: "Olivia Rodrigo" }, "tok", { ...opts, fetchImpl });
    expect([result?.scanned, result?.complete]).toEqual([1, false]);
  });
});

describe("artistFacts", () => {
  const item = (id: string, year?: string, rank = "normal") => ({ rank, mainsnak: { datavalue: { value: { id } } }, ...(year ? { qualifiers: { P585: [{ datavalue: { value: { time: `+${year}-01-01T00:00:00Z` } } }] } } : {}) });
  const entity = { entities: { Q1: {
    descriptions: { en: { value: "American singer" } },
    sitelinks: { enwiki: { title: "Olivia Rodrigo", url: "https://en.wikipedia.org/wiki/Olivia_Rodrigo" } },
    claims: {
      P166: [item("Q10", "2020"), item("Q11", "2022"), item("Q12", "2021", "deprecated"), item("Q13")],
      P264: [item("Q20")],
      P2031: [{ mainsnak: { datavalue: { value: { time: "+2015-00-00T00:00:00Z" } } } }],
    },
  } } };
  const labels = { entities: { Q10: { labels: { en: { value: "Older Award" } } }, Q11: { labels: { en: { value: "Newer Award" } } }, Q13: {}, Q20: { labels: { en: { value: "Geffen" } } } } };

  it("names awards newest first, drops deprecated and unnamed ones, and adds the Wikipedia summary", async () => {
    const fetchImpl = routes({ "props=claims": entity, "props=labels": labels, "wikipedia.org": { extract: "Bio.", thumbnail: { source: "https://img" }, content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Olivia_Rodrigo" } } } });
    const facts = await artistFacts("Q1", { fetchImpl, useCache: false });
    expect(facts?.awards.map((a) => [a.name, a.year])).toEqual([["Newer Award", "2022"], ["Older Award", "2020"]]);
    expect(facts?.labels.map((l) => l.name)).toEqual(["Geffen"]);
    expect(facts?.activeFrom).toBe("2015");
    expect(facts?.wikipedia).toEqual({ url: "https://en.wikipedia.org/wiki/Olivia_Rodrigo", extract: "Bio.", imageUrl: "https://img" });
  });

  it("keeps the facts when Wikipedia is down", async () => {
    const fetchImpl = routes({ "props=claims": entity, "props=labels": labels, "wikipedia.org": fail(503) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const facts = await artistFacts("Q1", { fetchImpl, useCache: false });
    warn.mockRestore();
    expect(facts?.wikipedia).toBeNull();
    expect(facts?.awards).toHaveLength(2);
  });

  it("refuses anything that isn't a Wikidata id", async () => {
    const fetchImpl = vi.fn<FetchMock>();
    expect(await artistFacts("Q1&action=evil", { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("adds the artist's Commons photo, preferring the image Wikidata marks preferred", async () => {
    const image = (file: string, rank = "normal") => ({ rank, mainsnak: { datavalue: { value: file } } });
    const withImage = { entities: { Q1: { ...entity.entities.Q1, claims: { ...entity.entities.Q1.claims, P18: [image("Old.jpg"), image("Best.jpg", "preferred")] } } } };
    const fetchImpl = routes({ "props=claims": withImage, "props=labels": labels, "wikipedia.org": fail(404), "commons.wikimedia.org": commonsPage() });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const facts = await artistFacts("Q1", { fetchImpl, useCache: false });
    warn.mockRestore();
    expect(facts?.photo?.author).toBe("Jane Photographer");
    const commonsUrl = fetchImpl.mock.calls.map(([url]) => String(url)).find((url) => url.includes("commons"));
    expect(new URL(commonsUrl!).searchParams.get("titles")).toBe("File:Best.jpg");
  });
});

/** A Commons imageinfo reply for one file; `meta` overrides the license metadata. */
const commonsPage = (meta: Record<string, string> = {}, info: Record<string, unknown> = {}) => ({ query: { pages: [{ title: "File:Best.jpg", imageinfo: [{
  thumburl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b0/Best.jpg/330px-Best.jpg",
  descriptionurl: "https://commons.wikimedia.org/wiki/File:Best.jpg",
  mime: "image/jpeg",
  extmetadata: Object.fromEntries(Object.entries({
    Artist: '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane Photographer</a>',
    LicenseShortName: "CC BY-SA 4.0",
    LicenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    NonFree: "false",
    ...meta,
  }).map(([key, value]) => [key, { value }])),
  ...info,
}] }] } });

describe("commonsPhoto", () => {
  it("returns a free photo with its author, license and file page", async () => {
    const photo = await commonsPhoto("Best.jpg", { fetchImpl: routes({ "commons.wikimedia.org": commonsPage() }), useCache: false });
    expect(photo).toEqual({
      url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b0/Best.jpg/330px-Best.jpg",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Best.jpg",
      author: "Jane Photographer",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    });
  });

  it("skips non-free files, other formats and images off Wikimedia's media hosts", async () => {
    const photo = (meta: Record<string, string>, info: Record<string, unknown> = {}) =>
      commonsPhoto("Best.jpg", { fetchImpl: routes({ "commons.wikimedia.org": commonsPage(meta, info) }), useCache: false });
    expect(await photo({ LicenseShortName: "CC BY-NC 2.0" })).toBeNull();
    expect(await photo({ LicenseShortName: "Fair use" })).toBeNull();
    expect(await photo({ NonFree: "true" })).toBeNull();
    expect(await photo({}, { mime: "image/svg+xml" })).toBeNull();
    expect(await photo({}, { thumburl: "https://example.com/Best.jpg" })).toBeNull();
  });

  it("is null for a missing file, and never asks about a name that could change the query", async () => {
    const missing = routes({ "commons.wikimedia.org": { query: { pages: [{ title: "File:Gone.jpg", missing: true }] } } });
    expect(await commonsPhoto("Gone.jpg", { fetchImpl: missing, useCache: false })).toBeNull();
    const fetchImpl = vi.fn<FetchMock>();
    expect(await commonsPhoto("A.jpg|File:B.jpg", { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("isFreeLicense", () => {
  it("allows public domain, CC0, CC BY and CC BY-SA in any version", () => {
    for (const name of ["Public domain", "PD-US", "CC0", "CC BY 2.0", "CC BY-SA 4.0", "cc-by-sa-3.0-de"]) expect(isFreeLicense(name)).toBe(true);
  });

  it("refuses non-commercial, no-derivatives and unknown terms", () => {
    for (const name of ["CC BY-NC 2.0", "CC BY-ND 4.0", "CC BY-NC-SA 3.0", "Fair use", "GFDL", ""]) expect(isFreeLicense(name)).toBe(false);
  });
});

describe("plainText", () => {
  it("drops tags, including ones rebuilt by a single pass, and decodes entities once", () => {
    expect(plainText('<a href="x">Jane</a> &amp; <b>Joe</b>')).toBe("Jane & Joe");
    expect(plainText("<scr<b>ipt>alert(1)")).not.toMatch(/[<>]/);
    expect(plainText("&amp;quot;")).toBe("&quot;");
  });
});

describe("listenBrainzAudience", () => {
  it("reads counts by id and skips artists it has no data for", async () => {
    const fetchImpl = routes({ "popularity/artist": [{ artist_mbid: "a", total_listen_count: 10, total_user_count: 2 }, { artist_mbid: "b", total_listen_count: null, total_user_count: null }] });
    const out = await listenBrainzAudience(["a", "b"], { fetchImpl, useCache: false });
    expect(out.get("a")).toEqual({ listeners: 2, listens: 10, url: "https://listenbrainz.org/artist/a" });
    expect(out.has("b")).toBe(false);
    expect(fetchImpl.mock.calls[0][1]!.method).toBe("POST");
  });
});

describe("Last.fm", () => {
  const opts = { useCache: false };
  it("reads audience numbers, which arrive as strings", async () => {
    const fetchImpl = routes({ "artist.getinfo": { artist: { url: "https://last.fm/x", stats: { listeners: "1200", playcount: "5000" } } } });
    expect(await lastFmAudience("m", "k", { ...opts, fetchImpl })).toEqual({ listeners: 1200, plays: 5000, url: "https://last.fm/x" });
  });
  it("treats an unknown id as no data, and other errors as failures", async () => {
    expect(await lastFmAudience("m", "k", { ...opts, fetchImpl: routes({ "artist.getinfo": { error: 6, message: "not found" } }) })).toBeNull();
    expect(await lastFmAudience("m", "k", { ...opts, fetchImpl: routes({ "artist.getinfo": fail(404) }) })).toBeNull();
    await expect(lastFmAudience("m", "k", { ...opts, fetchImpl: routes({ "artist.getinfo": { error: 10, message: "bad key" } }) })).rejects.toThrow("Last.fm error 10");
  });
  it("lists similar artists", async () => {
    const fetchImpl = routes({ "artist.getsimilar": { similarartists: { artist: [{ name: "X", mbid: "", url: "u" }, { name: "", url: "v" }] } } });
    expect(await lastFmSimilar("m", "k", { ...opts, fetchImpl })).toEqual([{ name: "X", mbid: null, url: "u" }]);
  });
});

describe("what two artists share", () => {
  it("keeps an entry once, with its newest year", () => {
    const a = [{ id: "1", name: "Grammy", year: "2022" }, { id: "1", name: "Grammy", year: "2020" }, { id: "2", name: "Other", year: "" }];
    expect(sharedEntries(a, [{ id: "1", name: "Grammy", year: "2015" }])).toEqual([{ id: "1", name: "Grammy", year: "2022" }]);
  });
  it("compares similar artists by id when there is one, and leaves out the two being compared", () => {
    const a = [{ name: "Same", mbid: "m1", url: "1" }, { name: "Named", mbid: null, url: "2" }, { name: "B", mbid: "b", url: "3" }, { name: "Only A", mbid: "m2", url: "4" }];
    const b = [{ name: "Same!", mbid: "m1", url: "1" }, { name: "named", mbid: null, url: "2" }, { name: "B", mbid: "b", url: "3" }];
    expect(sharedSimilar(a, b, ["a", "b"]).map((x) => x.name)).toEqual(["Same", "Named"]);
  });
});
