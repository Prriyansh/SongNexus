// @vitest-environment jsdom
// Small decisions that are easy to get wrong unnoticed: each of these was broken on purpose once,
// and nothing else failed.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/discover" }));
const links: { href: string; prefetch?: boolean }[] = [];
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ prefetch, ...props }: { href: string; prefetch?: boolean }) => {
      links.push({ href: props.href, prefetch });
      return createElement("a", props as never);
    },
  };
});

import ConnectionExplorer from "../components/ConnectionExplorer";
import ExplorerBar from "../components/ExplorerBar";
import { ArtistCard, ArtistLink, Chips, plural, Reasons, SongLink } from "../components/parts";
import ShareButton from "../components/ShareButton";
import { SidebarLinks } from "../components/SidebarLinks";
import SixDegreesForm from "../components/SixDegreesForm";
import {
  biggestGenres,
  biggestLabels,
  knownSongs,
  popularArtists,
  surprisePairs,
} from "../lib/browse";
import { buildCatalog, type RawCatalog } from "../lib/catalog";
import { buildGraph, evidenceBetween, neighbors } from "../lib/graph";
import { photoAt } from "../lib/images";
import { findPath } from "../lib/paths";
import { searchCatalog } from "../lib/search";
import { graph, neighborhood } from "../lib/server";
import { CATEGORIES, DEFAULT_CATEGORIES, type EntityRef } from "../lib/types";
import { artistNote, partName, reasonOf, songRef } from "../lib/words";
import { all, box, browser, click, control, find, mount, render, unmount } from "./dom";
import { ANNA, artistId, DEV, fixture } from "./fixture";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A catalog from just what a test needs. */
function made(parts: Partial<RawCatalog> & { names: string[]; listeners?: (number | null)[] }) {
  const { names, listeners = [], ...rest } = parts;
  return buildCatalog({
    version: 1,
    roles: ["primary", "producer"],
    details: [""],
    relationTypes: ["member_of"],
    artists: names.map((name, i) => [
      uuid(i),
      name,
      null,
      null,
      null,
      null,
      null,
      2,
      listeners[i] ?? null,
      [],
      [],
    ]),
    extras: {},
    photos: {},
    genres: [],
    labels: [],
    songs: [],
    releases: [],
    relations: [],
    ...rest,
  });
}

describe("ways in", () => {
  it("say how many steps apart a pair really is", () => {
    const g = graph();
    for (const { from, to, steps } of surprisePairs(g)) {
      const [a, b] = [from, to].map(({ id }) => g.catalog.artistAt.get(id)!);
      expect(steps).toBe(findPath(g, a, b, { categories: DEFAULT_CATEGORIES })!.length - 1);
    }
  });

  it("put the most listened to first, unknown counts last, and ties in order", () => {
    const c = made({ names: ["none", "few", "many", "also few"], listeners: [null, 5, 90, 5] });
    expect(popularArtists(c, 9).map((a) => a.name)).toEqual(["many", "few", "also few", "none"]);
    expect(popularArtists(c, 2)).toHaveLength(2);
  });

  it("leave out artists without full pages", () => {
    const c = made({ names: ["full", "stub"] });
    c.artists[1].level = 0;
    expect(popularArtists(c, 9).map((a) => a.name)).toEqual(["full"]);
  });

  it("put the biggest genres and labels first, then by name, without placeholder labels", () => {
    const c = made({
      names: ["a", "b"],
      genres: [
        ["zed", "zed", []],
        ["art", "art", []],
        ["big", "big", []],
      ],
      labels: [
        [uuid(91), "[no label]"],
        [uuid(92), "Zed"],
        [uuid(93), "Art"],
      ],
      releases: [0, 0, 1, 2].map((label, i) => [
        uuid(80 + i),
        "x",
        2000,
        null,
        [0],
        [label],
        [],
        [],
      ]),
    });
    c.genreArtists[0].push(0);
    c.genreArtists[1].push(0);
    c.genreArtists[2].push(0, 1);
    expect(biggestGenres(c, 9).map((g) => g.name)).toEqual(["big", "art", "zed"]);
    expect(biggestLabels(c, 9).map((l) => l.name)).toEqual(["Art", "Zed"]);
  });

  it("take one own song from each known artist", () => {
    const c = made({
      names: ["a", "b"],
      listeners: [9, 1],
      songs: [
        [uuid(60), "a produced", 2000, null, [0, 1, 0, 1, 0, 0]],
        [uuid(61), "a sang", 2000, null, [0, 0, 0]],
        [uuid(62), "a sang too", 2000, null, [0, 0, 0]],
      ],
    });
    expect(knownSongs(c, 9).map((s) => c.songs[s].title)).toEqual(["a sang", "a produced"]);
  });
});

describe("search", () => {
  const first = (names: string[], query: string, listeners?: number[]) =>
    searchCatalog(made({ names, listeners }), query, ["artist"]).map((r) => r.name);

  it("puts a whole name before a longer one, however popular", () => {
    expect(first(["Queen Latifah", "Queen"], "queen", [1e6, 1])).toEqual([
      "Queen",
      "Queen Latifah",
    ]);
    expect(first(["Beatles Tribute", "The Beatles"], "beatles", [1e6, 1])[0]).toBe("The Beatles");
    expect(first(["AC/DC Tribute", "AC/DC"], "acdc", [1e6, 1])[0]).toBe("AC/DC");
  });

  it("puts the start of a name before a word inside one", () => {
    expect(first(["The Great Stone", "Stone Roses"], "stone", [1e6, 1])).toEqual([
      "Stone Roses",
      "The Great Stone",
    ]);
  });

  it("orders equal matches by how known they are", () => {
    expect(first(["Star One", "Star Two"], "star", [1, 100])).toEqual(["Star Two", "Star One"]);
  });

  it("never matches the middle of a word", () => {
    expect(first(["Foreigner"], "eign")).toEqual([]);
  });

  it("gives artists their photo and songs their cover", () => {
    const c = fixture();
    expect(searchCatalog(c, "anna", ["artist"])[0].image).toContain("Anna.jpg");
    expect(searchCatalog(c, "first", ["song"])[0].image).toBeNull();
    c.releases[0].cover = "https://coverartarchive.org/x.jpg";
    expect(searchCatalog(c, "first", ["song"])[0].image).toBe("https://coverartarchive.org/x.jpg");
  });
});

describe("words", () => {
  it("say how someone took part", () => {
    expect(partName("instrument", "guitar")).toBe("guitar");
    expect(partName("instrument", "")).toBe("an instrument");
    expect(partName("vocal", "")).toBe("vocals");
    expect(partName("vocal", "backing vocals")).toBe("backing vocals");
    expect(partName("remixer", "")).toBe("the remix");
    expect(partName("performer", "")).toBe("a performance");
    expect(partName("performer", "whistling")).toBe("whistling");
  });

  it("tell an artist apart by their own note, else genre and country, else nothing", () => {
    const c = fixture();
    expect(artistNote(c, { ...c.artists[ANNA], disambiguation: "the one" })).toBe("the one");
    expect(artistNote(c, c.artists[ANNA])).toBe("pop · Sweden");
    expect(artistNote(c, { ...c.artists[ANNA], country: null })).toBe("pop");
    expect(artistNote(c, { ...c.artists[ANNA], genres: [] })).toBe("Sweden");
    expect(artistNote(c, { ...c.artists[ANNA], genres: [], country: "XE" })).toBe("");
  });

  it("describe every kind of relationship", () => {
    const types = [
      ["member_of", "A is or was a member of B"],
      ["has_subgroup", "B is a subgroup of A"],
      ["performs_as", "A performs as B"],
      ["collaboration_in", "A is part of B"],
      ["supported", "A played in the band of B"],
      ["taught", "A taught B"],
    ];
    for (const [type, words] of types) {
      const c = made({
        names: ["A", "B"],
        relationTypes: [type],
        relations: [[0, 1, 0, null, null]],
      });
      const [e] = evidenceBetween(c, 0, 1, CATEGORIES);
      expect(reasonOf(c, e)).toEqual({ category: "bands", text: words, subject: null, year: null });
    }
  });

  it("use one form for one and another for the rest", () => {
    expect(plural(1, "step")).toBe("1 step");
    expect(plural(0, "step")).toBe("0 steps");
    expect(plural(1234, "person", "people")).toBe("1,234 people");
  });
});

describe("connections", () => {
  it("make label mates when any of their albums were close, not only all", () => {
    const album = (n: number, year: number, artist: number) =>
      [uuid(n), "x", year, null, [artist], [0], [], []] as RawCatalog["releases"][number];
    const c = made({
      names: ["a", "b"],
      labels: [[uuid(9), "L"]],
      releases: [album(1, 1970, 0), album(2, 2000, 0), album(3, 2003, 1), album(4, 2020, 1)],
    });
    expect(neighbors(buildGraph(c), 0, ["labels"])).toHaveLength(1);
    const apart = made({
      names: ["a", "b"],
      labels: [[uuid(9), "L"]],
      releases: [album(1, 2000, 0), album(2, 2004, 1)],
    });
    expect(neighbors(buildGraph(apart), 0, ["labels"])).toHaveLength(0);
  });

  it("explain with the strongest kinds first, the oldest of those first, and undated last", () => {
    const song = (n: number, year: number | null, flat: number[]) =>
      [uuid(n), `S${n}`, year, null, flat] as RawCatalog["songs"][number];
    const together = [0, 0, 0, 1, 0, 0];
    const c = made({
      names: ["a", "b"],
      songs: [song(1, null, together), song(2, 2010, together), song(3, 1990, together)],
      relations: [[0, 1, 0, 2020, null]],
    });
    expect(evidenceBetween(c, 0, 1, CATEGORIES).map((e) => [e.kind, e.year])).toEqual([
      ["member_of", 2020],
      ["performed_with", 1990],
      ["performed_with", 2010],
      ["performed_with", null],
    ]);
  });
});

describe("photo sizes", () => {
  const at = (stored: number, width: number) =>
    Number(/\/(\d+)px-/.exec(photoAt(`https://x/a.jpg/${stored}px-a.jpg`, width))![1]);

  it("are exact at the widths Commons keeps", () => {
    expect([at(330, 120), at(330, 121), at(330, 250), at(330, 251)]).toEqual([120, 250, 250, 330]);
    expect([at(330, 330), at(330, 331), at(120, 500)]).toEqual([330, 330, 120]);
  });
});

describe("what is drawn", () => {
  beforeEach(() => {
    browser();
    mount();
    push.mockClear();
    links.length = 0;
    vi.stubGlobal("fetch", () => new Promise(() => {}));
  });
  afterEach(async () => {
    await unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const song: EntityRef = { kind: "song", id: "s", name: "Song", note: "Anna" };
  const artist = { id: "a", name: "Anna", note: "singer", listeners: 1, photo: null };

  it("a song has its artist under it, or what else is asked for", async () => {
    await render(
      <>
        <SongLink song={song} />
        <SongLink song={song} note="1999" />
      </>,
    );
    expect(all("small").map((s) => s.textContent)).toEqual(["Anna", "1999"]);
  });

  it("long lists don’t load every page they link to in advance", async () => {
    await render(
      <>
        <SongLink song={song} />
        <ArtistLink artist={artist} />
        <ArtistCard artist={artist} />
        <Chips label="x" items={[song]} />
        <Reasons
          total={1}
          reasons={[{ category: "bands", text: "t", subject: song, year: null }]}
        />
        <ConnectionExplorer
          start={neighborhood(buildGraph(fixture()), ANNA, DEFAULT_CATEGORIES, 5)}
          opened={[]}
          categories={[...DEFAULT_CATEGORIES]}
        />
      </>,
    );
    expect(links.length).toBeGreaterThan(5);
    expect(links.every((link) => link.prefetch === false)).toBe(true);
  });

  it("only the page you are on has the mark beside it", async () => {
    await render(<SidebarLinks pathname="/discover/connections" />);
    expect(all(".nav-track")).toHaveLength(1);
    expect(find(".nav-track").closest("a")!.getAttribute("href")).toBe("/discover/connections");
  });

  it("the share button’s picture says what it will do, and that it did", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => {} } });
    const picture = () => find("svg").getAttribute("class");
    await render(<ShareButton label="Share" />);
    const share = picture();
    await render(<ShareButton label="Copy" text="x" />);
    const copy = picture();
    await click(find("button"));
    expect(new Set([share, copy, picture()]).size).toBe(3);
  });

  it("stronger connections are thicker lines, and no line is out of range", async () => {
    const g = buildGraph(fixture());
    const start = neighborhood(g, DEV, DEFAULT_CATEGORIES, 5);
    await render(
      <ConnectionExplorer start={start} opened={[]} categories={[...DEFAULT_CATEGORIES]} />,
    );
    const widths = all(".dx-edge").map((e) => Number(e.getAttribute("stroke-width")));
    for (const w of widths) expect(w > 1 && w <= 6).toBe(true);
    const strongest = start.edges.reduce(
      (best, e, i) => (e.strength > start.edges[best].strength ? i : best),
      0,
    );
    expect(widths[strongest]).toBe(Math.max(...widths));
    expect(Math.max(...widths)).toBe(6);
  });

  it("choosing doesn’t scroll the page", async () => {
    await render(<ExplorerBar artist={artistId(ANNA)} categories={[...DEFAULT_CATEGORIES]} />);
    expect(find(".dx-busy").hasAttribute("data-on")).toBe(false);
    await act(async () => find<HTMLInputElement>("[data-category=labels] input").click());
    expect(push.mock.lastCall![1]).toEqual({ scroll: false });
    const artist = { id: "a", name: "Anna", note: "", listeners: null, photo: null };
    const state = { from: artist, to: null, categories: [...DEFAULT_CATEGORIES], avoid: [] };
    await render(<SixDegreesForm state={{ ...state, order: "shortest" }} surprises={[]} />);
    await click(control("Swap the two artists"));
    expect(push.mock.lastCall).toEqual(["/discover/six-degrees?to=a", { scroll: false }]);
  });

  it("pictures that only decorate are hidden from screen readers", async () => {
    const start = neighborhood(buildGraph(fixture()), ANNA, DEFAULT_CATEGORIES, 5);
    await render(
      <>
        <ExplorerBar artist={artistId(ANNA)} categories={[...DEFAULT_CATEGORIES]} />
        <ConnectionExplorer start={start} opened={[]} categories={[...DEFAULT_CATEGORIES]} />
      </>,
    );
    for (const icon of all("svg.lucide, .dx-avatar, .dx-cover, .dx-busy")) {
      expect(icon.getAttribute("aria-hidden"), icon.outerHTML.slice(0, 80)).toBe("true");
    }
    // And every control has a name.
    for (const button of all("button, a, input:not([type=checkbox])")) {
      const name =
        button.getAttribute("aria-label") ||
        button.textContent ||
        box.querySelector(`label[for="${button.id}"]`)?.textContent;
      expect(name, button.outerHTML.slice(0, 80)).toBeTruthy();
    }
    expect(control("Undo")).toBeTruthy();
  });
});

it("a song’s cover is its first album’s that has one", () => {
  const album = (n: number, cover: string | null) =>
    [uuid(n), "x", 2000, cover, [0], [], [0], []] as RawCatalog["releases"][number];
  const c = made({
    names: ["a"],
    songs: [[uuid(60), "s", null, null, [0, 0, 0]]],
    releases: [album(1, null), album(2, "https://second"), album(3, "https://third")],
  });
  expect(songRef(c, 0).image).toBe("https://second");
});
