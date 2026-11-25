// Every page, rendered whole from the committed catalog.
import { beforeAll, describe, expect, it, vi } from "vitest";

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
  type Props = { href: string; prefetch?: boolean; scroll?: boolean; children?: unknown };
  return {
    default: ({ prefetch, scroll, ...props }: Props) => {
      void [prefetch, scroll];
      return createElement("a", props as never);
    },
  };
});

import ArtistPage, * as artistPage from "@/app/discover/artist/[id]/page";
import ConnectionsPage from "@/app/discover/connections/page";
import DiscoverError from "@/app/discover/error";
import GenrePage, * as genrePage from "@/app/discover/genre/[id]/page";
import LabelPage, * as labelPage from "@/app/discover/label/[id]/page";
import DiscoverLayout from "@/app/discover/layout";
import DiscoverNotFound from "@/app/discover/not-found";
import OpenGraphImage, * as openGraph from "@/app/discover/opengraph-image";
import DiscoverHome from "@/app/discover/page";
import SixDegreesPage from "@/app/discover/six-degrees/page";
import SongPage, * as songPage from "@/app/discover/song/[id]/page";
import { surprisePairs } from "../lib/browse";
import { catalog } from "../lib/catalog";
import { searchCatalog } from "../lib/search";
import { graph } from "../lib/server";
import { hrefsOf, query, renderPage, route, textOf } from "./render";

const c = catalog();
const artist = (name: string) => searchCatalog(c, name, ["artist"])[0].id;
const ABBA = artist("ABBA");
const TAYLOR = artist("Taylor Swift");
const KENDRICK = artist("Kendrick Lamar");
const unknown = "00000000-0000-4000-8000-000000000000";

/** A spread of a list: its ends, and evenly between. */
function sample<T>(list: T[], count: number): T[] {
  const step = Math.max(1, Math.floor(list.length / count));
  return list.filter((_, i) => i % step === 0 || i === list.length - 1);
}

const pages = {
  artist: (id: string) => ArtistPage(route(id)),
  song: (id: string) => SongPage(route(id)),
  label: (id: string) => LabelPage(route(id)),
  genre: (id: string) => GenrePage(route(encodeURIComponent(id))),
};
const known = {
  artist: (id: string) => c.artistAt.has(id),
  song: (id: string) => c.songAt.has(id),
  label: (id: string) => c.labelAt.has(id),
  genre: (id: string) => c.genreAt.has(decodeURIComponent(id)),
};
type Kind = keyof typeof pages;

/** Addresses outside Discover that its pages may lead to. */
const APP =
  /^\/(connections\?mode=(artist|song)&(artist|song)=|compare\/(artists\?artistA|songs\?songA)=)/;

/** What must be true of any page. */
function check(html: string) {
  expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  const words = textOf(html);
  expect(words).not.toMatch(/\b(undefined|NaN|null)\b|\[object/);
  for (const href of hrefsOf(html)) {
    const [, kind, id] = /^\/discover\/(artist|song|label|genre)\/(.+)$/.exec(href) ?? [];
    if (kind) expect(known[kind as Kind](id), href).toBe(true);
    else if (href.startsWith("/discover")) {
      const url = new URL(href, "http://x");
      expect(["/discover", "/discover/six-degrees", "/discover/connections"]).toContain(
        url.pathname,
      );
      for (const key of ["from", "to", "artist"]) {
        const at = url.searchParams.get(key);
        if (at) expect(known.artist(at), href).toBe(true);
      }
    } else if (href.startsWith("/")) expect(href).toMatch(APP);
    else expect(href).toMatch(/^(https:\/\/|http:\/\/en\.wikipedia|#)/);
  }
  // Pictures come only from the two places they are licensed through, and say their size.
  for (const [tag, src] of html.matchAll(/<img[^>]* src="([^"]+)"[^>]*>/g)) {
    expect(src).toMatch(/^https:\/\/((upload|thumb)\.wikimedia\.org|coverartarchive\.org)\//);
    expect(tag).toMatch(/ alt=""/);
    expect(tag).toMatch(/ width="\d+" height="\d+"/);
  }
  return words;
}

describe("a spread of every kind of page", () => {
  const c0 = c.artists;
  const cases: [Kind, string[]][] = [
    [
      "artist",
      [0, 1, 2]
        .flatMap((level) =>
          sample(
            c0.filter((a) => a.level === level),
            14,
          ),
        )
        .map((a) => a.id),
    ],
    ["song", sample(c.songs, 40).map((s) => s.id)],
    ["label", sample(c.labels, 30).map((l) => l.id)],
    ["genre", sample(c.genres, 30).map((g) => g.slug)],
  ];
  it.each(cases)(
    "%s pages render, and every link on them leads somewhere",
    async (kind, ids) => {
      expect(ids.length).toBeGreaterThan(25);
      for (const id of ids) check(await renderPage(await pages[kind](id)));
    },
    120_000,
  );

  it.each([
    [
      "nothing but a name",
      (a: (typeof c0)[0]) => !a.genres.length && !a.photo && !a.disambiguation,
    ],
    ["many genres and a photo", (a: (typeof c0)[0]) => a.genres.length === 8 && a.photo !== null],
    ["an end", (a: (typeof c0)[0]) => a.end !== null],
    [
      "nominations only",
      (a: (typeof c0)[0]) => !a.extras.facts?.[2].length && !!a.extras.facts?.[3].length,
    ],
    ["events and no facts", (a: (typeof c0)[0]) => !!a.extras.events && !a.extras.facts],
    ["charts", (a: (typeof c0)[0]) => !!a.extras.hot100 && !a.extras.albums],
  ])(
    "an artist with %s",
    async (_, test) => {
      const found = c0.filter(test);
      expect(found.length).toBeGreaterThan(0);
      for (const a of sample(found, 3)) check(await renderPage(await ArtistPage(route(a.id))));
    },
    60_000,
  );
});

describe("artist pages", () => {
  let words: string;
  let html: string;
  beforeAll(async () => {
    html = await renderPage(await ArtistPage(route(ABBA)));
    words = check(html);
  });

  it("say who it is, with the numbers and where they come from", () => {
    expect(words).toContain("Group · Sweden · formed 1972, ended 2022 ABBA Swedish pop quartet");
    expect(words).toMatch(/collaborators \d+/);
    expect(words).toContain("ListenBrainz listeners");
    expect(words).toContain("The albums in this catalog, not a full discography.");
    expect(words).toContain("As listed on Wikidata , which is community-edited");
  });

  it("credit the photo", () => {
    const { photo } = c.artists[c.artistAt.get(ABBA)!];
    expect(html).toContain(photo!.page);
    expect(words).toContain(`Photo: ${photo!.author} , ${photo!.license}`);
  });

  it("show charts and contests", () => {
    expect(words).toMatch(
      /Hot 100 .*Billboard 200 .*Eurovision 1974 “ ?Waterloo ?” for ?Sweden ?, which won ?with 24 points/,
    );
  });

  it("lead to the rest of Song Nexus by MusicBrainz ID", () => {
    expect(hrefsOf(html)).toEqual(
      expect.arrayContaining([
        `/discover/six-degrees?from=${ABBA}`,
        `/discover/connections?artist=${ABBA}`,
        `/connections?mode=artist&artist=${ABBA}`,
        `/compare/artists?artistA=${ABBA}`,
        `https://musicbrainz.org/artist/${ABBA}`,
      ]),
    );
  });

  it("count collaborators the same way at the top and in the tabs", () => {
    const top = Number(/collaborators (\d+)/.exec(words)![1]);
    const tabs = [
      ...words.matchAll(
        /(?:Performed with|Production|Bands and projects|Other credits) · ([\d,]+)/g,
      ),
    ];
    const most = Math.max(...tabs.map(([, n]) => Number(n.replace(",", ""))));
    expect(most).toBeLessThanOrEqual(top);
  });

  it("explain artists who are only here through other people’s music", async () => {
    const stub = c.artists.find((a) => a.level === 0 && c.songsOf[c.artistAt.get(a.id)!].length)!;
    expect(textOf(await renderPage(await ArtistPage(route(stub.id))))).toContain(
      "is here through credits on other artists’ music",
    );
  });

  it("accept an ID in capitals", async () => {
    expect(textOf(await renderPage(await ArtistPage(route(ABBA.toUpperCase()))))).toContain("ABBA");
  });
});

describe("song, label and genre pages", () => {
  it("list a song’s people once per kind of credit, with the album", async () => {
    const at = c.songAt.get(searchCatalog(c, "Waterloo", ["song"])[0].id)!;
    const words = check(await renderPage(await SongPage(route(c.songs[at].id))));
    expect(words).toMatch(/^Song · 1974 · \d:\d\d Waterloo ABBA/);
    expect(words).toContain("Performers");
    expect(words).toContain("Album");
  });

  it("put a label’s most released artists first", async () => {
    const label = c.labels.reduce(
      (best, _, i) => (c.labelReleases[i].length > c.labelReleases[best].length ? i : best),
      0,
    );
    const words = check(await renderPage(await LabelPage(route(c.labels[label].id))));
    const counts = [...words.split("Oldest first.")[0].matchAll(/(\d+) albums?\b(?! by)/g)].map(
      ([, n]) => Number(n),
    );
    expect(counts.length).toBeGreaterThan(5);
    expect(counts).toEqual([...counts].sort((x, y) => y - x));
  });

  it("show a genre’s place among the others, and only artists who are really in it", async () => {
    const words = check(await renderPage(await GenrePage(route("pop"))));
    expect(words).toContain("Subgenres");
    const shares = [...words.matchAll(/(\d+) ?% ?pop/g)].map(([, n]) => Number(n));
    expect(shares.length).toBe(60);
    expect(Math.min(...shares)).toBeGreaterThanOrEqual(10);
  });
});

describe("addresses that aren’t in the catalog", () => {
  it.each(["artist", "song", "label", "genre"] as const)("are a %s not found", async (kind) => {
    await expect(pages[kind](unknown)).rejects.toThrow(NotFound);
  });

  it("include malformed ones", async () => {
    await expect(GenrePage(route("%E0%A4%A"))).rejects.toThrow(NotFound);
    await expect(ArtistPage(route("../../etc/passwd"))).rejects.toThrow(NotFound);
    await expect(artistPage.generateMetadata(route(unknown))).rejects.toThrow(NotFound);
  });

  it("get a page that says so and offers a search", async () => {
    const words = check(await renderPage(<DiscoverNotFound />));
    expect(words).toContain("That isn’t in this catalog");
    expect(words).toContain("Search Discover");
  });
});

describe("titles, descriptions and ready-made pages", () => {
  const cases = [
    ["artist", artistPage, c.artistAt, "ABBA · Song Nexus"],
    ["song", songPage, c.songAt, null],
    ["label", labelPage, c.labelAt, null],
    ["genre", genrePage, c.genreAt, null],
  ] as const;

  it.each(cases)(
    "of %s pages are complete and ready for the best known",
    async (kind, page, at) => {
      const ready = page.generateStaticParams();
      expect(ready.length).toBeGreaterThan(20);
      expect(new Set(ready.map((p) => p.id)).size).toBe(ready.length);
      for (const { id } of ready) {
        expect(at.has(id)).toBe(true);
        const meta = await page.generateMetadata(route(encodeURIComponent(id)));
        expect(meta.title).toMatch(/^\S.* · Song Nexus$/);
        expect(String(meta.description).length).toBeGreaterThan(12);
        expect(String(meta.description)).not.toMatch(
          /undefined|null|NaN|, :|\b1 (artists|albums|collaborators)\b/,
        );
        expect(meta.alternates?.canonical).toBe(`/discover/${kind}/${encodeURIComponent(id)}`);
        expect(meta.openGraph).toMatchObject({ title: meta.title, description: meta.description });
      }
    },
  );

  it("name the artist and the song with its artist", async () => {
    expect((await artistPage.generateMetadata(route(ABBA))).title).toBe("ABBA · Song Nexus");
    const waterloo = searchCatalog(c, "Waterloo", ["song"])[0].id;
    expect((await songPage.generateMetadata(route(waterloo))).title).toBe(
      "Waterloo by ABBA · Song Nexus",
    );
  });

  it("include a picture for shared links", async () => {
    const image = OpenGraphImage();
    expect(image.headers.get("content-type")).toBe(openGraph.contentType);
    const bytes = new Uint8Array(await image.arrayBuffer());
    expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
    expect(openGraph.size).toEqual({ width: 1200, height: 630 });
  }, 30_000);
});

describe("home", () => {
  it("offers pairs that really are that far apart", async () => {
    const html = await renderPage(<DiscoverHome />);
    const words = check(html);
    const [pair] = surprisePairs(graph());
    expect(words).toContain(`${pair.from.name} and ${pair.to.name}`);
    expect(hrefsOf(html)).toContain(`/discover/six-degrees?from=${pair.from.id}&to=${pair.to.id}`);
  });
});

describe("Six Degrees", () => {
  const open = async (params: Record<string, string | string[]> = {}) => {
    const html = await renderPage(SixDegreesPage(query(params)));
    return { html, words: check(html) };
  };

  it("asks for artists, with examples", async () => {
    const { words } = await open();
    expect(words).toContain("Try one of these");
    expect(words).not.toContain("apart Share");
  });

  it("shows the path, why each step, other ways, and songs to hear", async () => {
    const { html, words } = await open({ from: TAYLOR, to: KENDRICK });
    expect(words).toContain("2 steps apart");
    expect(words).toMatch(/Best path · 2 steps Another way · 3 steps/);
    expect(words).toContain("Hear the path");
    expect(html).toContain('aria-label="Artists on this path"');
    expect(hrefsOf(html).some((h) => h.includes("avoid="))).toBe(true);
  });

  it("keeps the choices in its links: kinds, order and people to go around", async () => {
    const { html, words } = await open({
      from: TAYLOR,
      to: KENDRICK,
      via: "producers,bands",
      order: "strongest",
    });
    expect(words).toContain("2 of 7 kinds of connection count");
    const around = hrefsOf(html).find((h) => h.includes("avoid="))!;
    expect(around).toContain("via=producers%2Cbands");
    expect(around).toContain("order=strongest");
    const avoided = new URL(around, "http://x").searchParams.get("avoid")!;
    const next = await open({ from: TAYLOR, to: KENDRICK, avoid: avoided });
    expect(next.words).toContain("Going around");
    expect(next.html.split("Artists on this path")[1].split("</ol>")[0]).not.toContain(avoided);
  });

  it("says when there is one artist, the same one twice, an unknown one, or no way", async () => {
    expect((await open({ from: TAYLOR })).words).toContain("Try one of these");
    expect((await open({ from: TAYLOR, to: TAYLOR })).words).toContain("the same artist twice");
    expect((await open({ from: TAYLOR, to: unknown })).words).toContain("Try one of these");
    const alone = c.artists.find((_, i) => graph().edges[i].size === 0);
    if (alone) {
      const { words } = await open({ from: TAYLOR, to: alone.id });
      expect(words).toContain("No connection within six steps in this catalog");
    }
  });

  it("survives a strange address", async () => {
    const { words } = await open({
      from: [TAYLOR, KENDRICK],
      to: "x".repeat(5000),
      order: "?",
      via: ",,",
    });
    expect(words).toContain("Taylor Swift");
  });
});

describe("Collaborators", () => {
  const open = async (params: Record<string, string> = {}) => {
    const html = await renderPage(ConnectionsPage(query(params)));
    return { html, words: textOf(html), nodes: html.match(/class="dx-node"/g)?.length ?? 0 };
  };

  it("starts from a well-known artist, or the one asked for", async () => {
    expect((await open()).nodes).toBeGreaterThan(5);
    const { html, words, nodes } = await open({ artist: KENDRICK });
    check(html);
    expect(nodes).toBe(23);
    expect(words).toMatch(/Closest of \d+ connections/);
  });

  it("rebuilds a web from its address", async () => {
    const dre = artist("Dr. Dre");
    expect((await open({ artist: KENDRICK, open: dre })).nodes).toBeGreaterThan(23);
    // An opened artist who is unknown, or is the starting one, adds nothing.
    expect((await open({ artist: KENDRICK, open: `${unknown},${KENDRICK}` })).nodes).toBe(23);
  });

  it("says when it doesn’t know the artist, or they have no such connections", async () => {
    expect((await open({ artist: unknown })).words).toContain("isn’t in this catalog");
    const lonely = c.artists.findIndex((_, i) => graph().edges[i].size === 0);
    if (lonely >= 0)
      expect((await open({ artist: c.artists[lonely].id })).words).toContain(
        "No one, through these kinds",
      );
  });
});

describe("the frame", () => {
  it("has a way past the navigation, one main region, and credits its sources", async () => {
    const html = await renderPage(
      <DiscoverLayout params={Promise.resolve({})}>content</DiscoverLayout>,
    );
    expect(html).toContain('href="#discover-main"');
    expect(html.match(/<main /g)).toHaveLength(1);
    expect(html).toContain('id="discover-main"');
    for (const source of [
      "MusicBrainz",
      "Discogs",
      "Wikidata",
      "Wikimedia Commons",
      "Cover Art Archive",
      "ListenBrainz",
      "Billboard",
      "Eurovision",
    ]) {
      expect(textOf(html)).toContain(source);
    }
  });

  it("shows a way to try again when a page fails", async () => {
    const words = textOf(
      await renderPage(<DiscoverError error={new Error("x")} retry={() => {}} />),
    );
    expect(words).toBe(
      "This page didn’t load Something went wrong on our side. Trying again usually works. Try again",
    );
  });
});
