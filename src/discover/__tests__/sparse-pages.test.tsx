// Pages for what the committed catalog happens not to have: undated songs and albums, an artist
// with nothing to say about them, a photo without an author, a lone album, a genre without
// artists, a path with no songs to play. The catalog here is made up for it.
import { describe, expect, it, vi } from "vitest";

class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/discover",
}));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return { default: ({ prefetch, scroll, ...props }: { href: string; prefetch?: boolean; scroll?: boolean }) => (void [prefetch, scroll], createElement("a", props)) };
});

const { SOLO, PARTNER, GROUP, LONELY, FRIEND, PEER, PRIMARY, FEATURED, PRODUCER, id, song, release, LABEL } = vi.hoisted(() => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    SOLO: 0, PARTNER: 1, GROUP: 2, LONELY: 3, FRIEND: 4, PEER: 5,
    PRIMARY: 0, FEATURED: 1, PRODUCER: 2,
    id: (at: number) => uuid(100 + at),
    song: (at: number) => uuid(200 + at),
    release: (at: number) => uuid(300 + at),
    LABEL: uuid(1),
  };
});

vi.mock("../lib/catalog", async (original) => {
  const actual = await original<typeof import("../lib/catalog")>();
  const person = (name: string, extra: Partial<Record<number, unknown>> = {}) => {
    const row: unknown[] = [null, name, "Person", "SE", null, null, null, 2, null, [], []];
    for (const [i, v] of Object.entries(extra)) row[Number(i)] = v;
    return row;
  };
  const raw = {
    version: 1,
    roles: ["primary", "featured", "producer"],
    details: [""],
    relationTypes: ["member_of"],
    artists: [
      person("Solo", { 3: null, 9: [1, 100] }),
      person("Partner"),
      person("The Group", { 2: "Group" }),
      person("Lonely", { 3: null }),
      person("Friend"),
      person("Peer"),
    ].map((row, at) => ((row[0] = id(at)), row)),
    extras: {
      [SOLO]: {
        facts: [null, null, [["Q1", "A Prize", null]], [], null],
        eurovision: [[2000, "Sweden", "Placed Song", 5, null, null], [2001, "Sweden", "Unplaced Song", null, 10, null]],
        events: [["ev-1", "A Festival", null, null]],
      },
    },
    photos: { [SOLO]: ["https://upload.wikimedia.org/wikipedia/commons/a/ab/Solo.jpg", "https://commons.wikimedia.org/wiki/File:Solo.jpg", null, "CC0", null] },
    genres: [["pop", "pop", []], ["synth-pop", "synth-pop", [0]]],
    labels: [[LABEL, "A Label"]],
    songs: [
      [song(0), "Undated", null, null, [SOLO, PRIMARY, 0, PARTNER, FEATURED, 0]],
      [song(1), "Dated", 2005, null, [SOLO, PRIMARY, 0, PARTNER, PRODUCER, 0]],
      [song(2), "Also Undated", null, null, [SOLO, PRIMARY, 0, FRIEND, FEATURED, 0]],
      [song(3), "Instrumental", 2006, null, [PARTNER, PRODUCER, 0]],
      [song(4), "Peer Song", 2007, null, [PEER, PRIMARY, 0]],
    ],
    releases: [
      [release(0), "Only Album", null, null, [SOLO], [0], [0], []],
      [release(1), "Partner Album", 2005, null, [PARTNER], [0], [1], []],
      [release(2), "Peer Album", null, null, [PEER], [0], [4], []],
      [release(3), "Peer Dated Album", 2010, null, [PEER], [0], [4], []],
      [release(4), "Peer Second Undated", null, null, [PEER], [0], [4], []],
    ],
    relations: [[SOLO, GROUP, 0, null, null]],
  };
  const sparse = actual.buildCatalog(raw as never);
  return { ...actual, catalog: () => sparse };
});

import ArtistPage, * as artistPage from "@/app/discover/artist/[id]/page";
import * as genrePage from "@/app/discover/genre/[id]/page";
import LabelPage from "@/app/discover/label/[id]/page";
import SixDegreesPage from "@/app/discover/six-degrees/page";
import * as songPage from "@/app/discover/song/[id]/page";
import { query, renderPage, route, textOf } from "./render";

/** A page's words, without the spaces tags leave before punctuation and inside quotes. */
const page = async (element: Promise<React.ReactElement> | React.ReactElement) =>
  textOf(await renderPage(await element)).replace(/\s+([,.”])/g, "$1").replace(/“\s+/g, "“");

describe("an artist's page with sparse facts", () => {
  it("says what is known, in the right words, and nothing about what isn't", async () => {
    const words = await page(ArtistPage(route(id(SOLO))));
    expect(words).toContain("album here 1");
    expect(words).toContain("“Placed Song” for Sweden, placed 5");
    expect(words).toContain("“Unplaced Song” for Sweden with 10 points");
    expect(words).toContain("As listed on Wikidata,"); // no Wikidata link without its id
    expect(words).toContain("The latest of 1 concert or festival MusicBrainz lists.");
    expect(words).toContain("Photo: see its page, CC0, via Wikimedia Commons");
    // Performing, both have only undated songs, so no years are given.
    expect(words).toContain("Partner 1 credit F Friend 1 credit Albums");
  });

  it("is described by its name alone when there is nothing else to say", async () => {
    const meta = await artistPage.generateMetadata(route(id(LONELY)));
    expect(meta.description).toMatch(/^Lonely: 0 collaborators, songs, albums/);
  });

  it("lists undated albums and songs after dated ones", async () => {
    const words = await page(LabelPage(route(LABEL)));
    expect(words.indexOf("Partner Album")).toBeLessThan(words.indexOf("Only Album"));
    const songs = (await page(ArtistPage(route(id(SOLO))))).split("Songs")[1];
    expect(songs.indexOf("Dated")).toBeLessThan(songs.indexOf("Undated"));
    const albums = (await page(ArtistPage(route(id(PEER))))).split("Albums")[1];
    expect(albums.indexOf("Peer Dated Album")).toBeLessThan(albums.indexOf("Peer Album"));
  });
});

describe("other sparse pages", () => {
  it("describe a genre with no artists, and a song without a performer", async () => {
    expect((await genrePage.generateMetadata(route("pop"))).description).toBe("0 artists in pop.");
    expect((await songPage.generateMetadata(route(song(3)))).title).toBe("Instrumental · Song Nexus");
  });

  it("don't offer to play a path that has fewer than two songs", async () => {
    const words = await page(SixDegreesPage(query({ from: id(SOLO), to: id(GROUP), via: "band" })));
    expect(words).toContain("The Group");
    expect(words).not.toContain("Hear the path");
  });

  it("say a path couldn't be found going around the artists left out", async () => {
    const words = await page(SixDegreesPage(query({ from: id(SOLO), to: id(LONELY), avoid: id(PARTNER) })));
    expect(words).toContain("No connection within six steps in this catalog, going around the artists you left out.");
  });
});
