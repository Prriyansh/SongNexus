// artistNeighborhood for artists with little data: one genre or none, no usable country or era,
// odd label data, and every kind of relationship. artist-neighborhood.test.ts covers a full one.
import { afterEach, describe, expect, it } from "vitest";
import { artistNeighborhood, mergeRelatedArtists } from "../artist-neighborhood";
import { __clearCache } from "../musicbrainz";
import type { RelatedArtist } from "../types";
import { asked, fakeWeb, quick } from "./fake-web";
import type { Reply } from "./fake-web";

const id = (n: number) => `bb000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SELF = id(1), PEER = id(2), LABEL = id(3), OTHER_LABEL = id(4), RELEASE = id(5), MEMBER = id(6);
const person = (gid: string, name: string, extra = {}) => ({ id: gid, name, type: "Person", country: "GB", ...extra });
afterEach(() => __clearCache());

type Scene = { anchor?: object; search?: (query: string) => Reply; eras?: Reply; byArtist?: Reply; byLabel?: Reply; member?: Reply };
/** MusicBrainz for one artist's neighborhood; anything not given answers empty. */
const scene = (s: Scene) =>
  fakeWeb((url) => {
    const q = url.searchParams;
    if (url.pathname === `/ws/2/artist/${SELF}`) return { ...person(SELF, "Self"), ...s.anchor };
    if (url.pathname === `/ws/2/artist/${MEMBER}`) return s.member ?? {};
    if (url.pathname === "/ws/2/release-group") return q.has("artist") ? { "release-groups": [] } : s.eras ?? {};
    if (url.pathname === "/ws/2/artist") return s.search?.(q.get("query")!) ?? { artists: [] };
    if (url.pathname === "/ws/2/release") return q.has("label") ? s.byLabel ?? {} : s.byArtist ?? {};
  });
const run = (s: Scene) => artistNeighborhood(SELF, { ...quick, maxRetries: 0, fetchImpl: scene(s) });
const queries = (fetchImpl: ReturnType<typeof scene>) => asked(fetchImpl).map((u) => new URL(u).searchParams.get("query")).filter(Boolean);

describe("an artist with little to go on", () => {
  it("asks only about labels when it has no genre, usable country or era", async () => {
    const fetchImpl = scene({ anchor: { country: "XW" } });
    const result = await artistNeighborhood(SELF, { ...quick, maxRetries: 0, fetchImpl });
    expect(queries(fetchImpl)).toEqual([]);
    expect(result).toMatchObject({ artists: [], failed: [] });
  });

  it("searches its country without a genre, and keeps only artists actually from there", async () => {
    const fetchImpl = scene({ anchor: { country: "SE" }, search: () => ({ artists: [person(PEER, "Swede", { country: "SE" }), person(id(9), "Not Swede", { country: "NO" })] }) });
    const result = await artistNeighborhood(SELF, { ...quick, maxRetries: 0, fetchImpl });
    expect(queries(fetchImpl)).toEqual(["country:SE"]);
    expect(result.artists.map((a) => [a.name, a.reasons.map((r) => r.text)])).toEqual([["Swede", ["Also from SE"]]]);
  });

  it("searches one genre alone when it has only one", async () => {
    const fetchImpl = scene({ anchor: { country: "", genres: [{ name: "folk", count: 2 }] } });
    await artistNeighborhood(SELF, { ...quick, maxRetries: 0, fetchImpl });
    expect(queries(fetchImpl)).toEqual(['tag:"folk"']);
  });

  it("looks for albums from its decade without a genre, and skips what it can't date or open", async () => {
    const group = { type: "Group", country: "", "life-span": { begin: "1971" } };
    const eras = { "release-groups": [
      { id: RELEASE, "first-release-date": "1975", "artist-credit": [{}, { artist: person(PEER, "Peer") }] },
      { id: id(10), "first-release-date": "1976" },
      { id: 42, "first-release-date": "1977", "artist-credit": [{ artist: person(id(11), "Bad id") }] },
    ] };
    const fetchImpl = scene({ anchor: group, eras });
    const result = await artistNeighborhood(SELF, { ...quick, maxRetries: 0, fetchImpl });
    expect(queries(fetchImpl)).toEqual(["firstreleasedate:[1970 TO 1979] AND primarytype:album"]);
    expect(result.artists.map((a) => [a.name, a.reasons.map((r) => r.text)])).toEqual([["Peer", ["Album released in 1975"]]]);
  });

  it("finds no era albums in a reply without them", async () => {
    expect((await run({ anchor: { type: "Group", country: "", "life-span": { begin: "1971" } } })).artists).toEqual([]);
  });
});

describe("label peers", () => {
  const info = (labelId: unknown, name: unknown) => ({ label: { id: labelId, name } });

  it("uses the label on most of its releases, ignoring placeholders and labels without an id or name", async () => {
    const byArtist = { releases: [
      {},
      { "label-info": [info(LABEL, "Main Label"), info("x", "No id"), info(OTHER_LABEL, 7), info(id(12), "[no label]")] },
      { "label-info": [info(LABEL, "Main Label"), info(OTHER_LABEL, "Other Label")] },
      { "label-info": [{}] },
    ] };
    const byLabel = { releases: [
      { id: RELEASE, "artist-credit": [{}, { artist: person(PEER, "Peer") }] },
      { id: "bad", "artist-credit": [{ artist: person(id(13), "From a bad release") }] },
      { id: id(14) },
    ] };
    const fetchImpl = scene({ anchor: { country: "" }, byArtist, byLabel });
    const result = await artistNeighborhood(SELF, { ...quick, maxRetries: 0, fetchImpl });
    expect(asked(fetchImpl).some((u) => u.includes(`label=${LABEL}`))).toBe(true);
    expect(result.artists.map((a) => [a.name, a.reasons[0].text])).toEqual([["Peer", "Release on Main Label"]]);
  });

  it("finds no peers when no release names a label, or the label's releases have none", async () => {
    expect((await run({ anchor: { country: "" }, byArtist: { releases: [{ "label-info": [] }] } })).artists).toEqual([]);
    expect((await run({ anchor: { country: "" }, byArtist: { releases: [{ "label-info": [info(LABEL, "L")] }] } })).artists).toEqual([]);
  });
});

describe("relationships", () => {
  const rel = (type: string, other: object, extra = {}) => ({ type, artist: other, ...extra });

  it("names current members and bands, and other relationships by their type", async () => {
    const group = await run({ anchor: { type: "Group", country: "", relations: [rel("member of band", person(MEMBER, "Current"))] } });
    expect(group.artists.find((a) => a.id === MEMBER)!.reasons[0].text).toBe("Member of Self");
    const solo = await run({ anchor: { country: "", relations: [rel("member of band", person(PEER, "The Band", { type: "Group" })), rel("collaboration", person(id(15), "Partner")), rel("producer", person(id(16), "Not musical"))] } });
    expect(solo.artists.map((a) => [a.name, a.reasons[0].kind, a.reasons[0].text])).toEqual([
      ["The Band", "band", "Band: The Band"],
      ["Partner", "collaborator", "collaboration · Self"],
    ]);
  });

  it("finds no shared members through a member without other bands", async () => {
    const result = await run({ anchor: { type: "Group", country: "", relations: [rel("member of band", person(MEMBER, "Member"))] }, member: person(MEMBER, "Member") });
    expect(result.artists.map((a) => a.id)).toEqual([MEMBER]);
  });
});

describe("merging related artists", () => {
  const related = (gid: string, name: string, country: string): RelatedArtist =>
    ({ ...person(gid, name, { country }), disambiguation: "", tags: [], lifeSpan: {}, reasons: [{ kind: "genre", text: "pop", sourceUrl: "u", relatedTo: SELF }] }) as RelatedArtist;

  it("keeps a country either source knew, and orders equals by name", () => {
    const merged = mergeRelatedArtists([related(PEER, "Zed", ""), related(PEER, "Zed", ""), related(id(20), "Amy", ""), related(id(20), "Amy", "SE")]);
    expect(merged.map((a) => [a.name, a.country])).toEqual([["Amy", "SE"], ["Zed", ""]]);
  });
});
