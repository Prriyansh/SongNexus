// @vitest-environment jsdom
// More small decisions, each once broken on purpose without another test noticing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let pathname = "/discover/connections";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => pathname }));

import ConnectionExplorer from "../components/ConnectionExplorer";
import DiscoverShell from "../components/DiscoverShell";
import EntitySearch from "../components/EntitySearch";
import { Avatar, Cover, Section } from "../components/parts";
import ShareButton from "../components/ShareButton";
import SixDegreesForm from "../components/SixDegreesForm";
import { buildCatalog, type RawCatalog } from "../lib/catalog";
import { collaborations, timeline } from "../lib/collaborations";
import { buildGraph, evidenceBetween } from "../lib/graph";
import {
  growWeb,
  layoutWeb,
  separate,
  startWeb,
  visibleLabels,
  type Label,
  type Point,
} from "../lib/layout";
import { neighborhood } from "../lib/server";
import { CATEGORIES, DEFAULT_CATEGORIES, type ArtistRef } from "../lib/types";
import { reasonOf } from "../lib/words";
import { all, box, browser, click, find, mount, press, render, settle, type, unmount } from "./dom";
import { ANNA, BEN, DEV, fixture } from "./fixture";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [PRIMARY, FEATURED, PRODUCER] = [0, 1, 2];

function songs(
  names: string[],
  list: [year: number | null, flat: number[]][],
  more: Partial<RawCatalog> = {},
) {
  return buildCatalog({
    version: 1,
    roles: ["primary", "featured", "producer"],
    details: [""],
    relationTypes: ["member_of"],
    artists: names.map((name, i) => [uuid(i), name, null, null, null, null, null, 2, null, [], []]),
    extras: {},
    photos: {},
    genres: [],
    labels: [],
    songs: list.map(([year, flat], i) => [uuid(50 + i), `S${i}`, year, null, flat]),
    releases: [],
    relations: [],
    ...more,
  });
}

describe("the facts", () => {
  it("of performing together are told apart by who is featured", () => {
    const said = (a: number, b: number) => {
      const c = songs(["A", "B"], [[2000, [0, a, 0, 1, b, 0]]]);
      return reasonOf(c, evidenceBetween(c, 0, 1, CATEGORIES)[0]).text;
    };
    expect(said(PRIMARY, PRIMARY)).toBe("A and B performed “S0” together");
    expect(said(PRIMARY, FEATURED)).toBe("B is featured on “S0” by A");
    expect(said(FEATURED, PRIMARY)).toBe("A is featured on “S0” by B");
    expect(said(FEATURED, FEATURED)).toBe("A and B are both featured on “S0”");
  });

  it("order collaborators by how much, then how early, undated last, then as listed", () => {
    const c = songs(
      ["me", "undated", "late", "early", "also early", "most"],
      [
        [null, [0, PRIMARY, 0, 1, PRODUCER, 0]],
        [2010, [0, PRIMARY, 0, 2, PRODUCER, 0]],
        [1990, [0, PRIMARY, 0, 3, PRODUCER, 0]],
        [1990, [0, PRIMARY, 0, 4, PRODUCER, 0]],
        [2015, [0, PRIMARY, 0, 5, PRODUCER, 0]],
        [2016, [0, PRIMARY, 0, 5, PRODUCER, 0]],
      ],
    );
    const { items } = collaborations(buildGraph(c), 0, "production", 9);
    expect(items.map((i) => i.artist.name)).toEqual([
      "most",
      "early",
      "also early",
      "late",
      "undated",
    ]);
  });

  it("by year leave out bands and labels, which aren’t songs", () => {
    const c = songs(["A", "B"], [[2000, [0, PRIMARY, 0, 1, PRODUCER, 0]]], {
      labels: [[uuid(90), "L"]],
      relations: [[0, 1, 0, 1995, null]],
      releases: [
        [uuid(91), "x", 1980, null, [0], [0], [], []],
        [uuid(92), "y", 1981, null, [1], [0], [], []],
      ],
    });
    expect(timeline(buildGraph(c), 0)).toEqual([{ year: 2000, count: 1 }]);
  });

  it("only draw lines that count", () => {
    const c = songs(["A", "B", "C"], [[2000, [0, PRIMARY, 0, 1, FEATURED, 0, 2, PRODUCER, 0]]]);
    const web = neighborhood(buildGraph(c), 2, ["producers"], 9);
    expect(web.nodes).toHaveLength(3);
    // A and B performed together, which wasn't asked for, so nothing is drawn between them.
    expect(web.edges).toHaveLength(2);
  });
});

describe("the web’s layout", () => {
  it("moves apart artists who would land on each other, and never the one in the middle", () => {
    const node = (id: string) => ({
      id,
      name: id,
      note: "",
      listeners: null,
      photo: null,
      degree: 1,
    });
    const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const web = {
      center: "n0",
      nodes: ids.map(node),
      // Everyone tied to everyone, as hard as can be: the simulation alone packs them together.
      edges: ids.flatMap((a, i) =>
        ids.slice(i + 1).map((b) => ({ a, b, strength: 99, category: "bands" as const, count: 1 })),
      ),
      opened: ["n0"],
    };
    const together = new Map<string, Point>(ids.map((id) => [id, { x: 0.1, y: 0.1 }]));
    const points = layoutWeb(web, together);
    expect(points.get("n0")).toEqual({ x: 0, y: 0 });
    const list = [...points.values()];
    list.forEach((p, i) =>
      list
        .slice(i + 1)
        .forEach((q) => expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(60)),
    );
  });

  it("spreads a pile-up in as many passes as it takes, and leaves good places alone", () => {
    const pile = Array.from({ length: 9 }, (_, i) => i * 0.5);
    const [x, y] = [Float64Array.from(pile), Float64Array.from(pile)];
    separate(x, y, 0);
    expect([x[0], y[0]]).toEqual([0, 0]);
    pile.forEach((_, i) =>
      pile.slice(i + 1).forEach((__, k) => {
        const j = i + 1 + k;
        expect(Math.hypot(x[i] - x[j], y[i] - y[j])).toBeGreaterThan(60);
      }),
    );
    const [fineX, fineY] = [Float64Array.from([0, 100]), Float64Array.from([0, 0])];
    separate(fineX, fineY, 0);
    expect([...fineX, ...fineY]).toEqual([0, 100, 0, 0]);
  });

  it("puts newcomers on the side of the one they come from", () => {
    const g = buildGraph(fixture());
    const web = startWeb(neighborhood(g, ANNA, DEFAULT_CATEGORIES, 9));
    const before = layoutWeb(web);
    const grown = growWeb(web, neighborhood(g, DEV, DEFAULT_CATEGORIES, 9));
    const after = layoutWeb(grown, before);
    const at = (name: string) => after.get(grown.nodes.find((n) => n.name === name)!.id)!;
    const [dev, eve] = [at("Dev"), at("The Eve Band")];
    expect(dev.x * eve.x + dev.y * eve.y).toBeGreaterThan(0);
  });

  it("gives the name being looked at its place before more important ones", () => {
    const label = (id: string, x: number, priority: number, always = false): Label => ({
      id,
      text: "long name here",
      x,
      y: 0,
      radius: 5,
      priority,
      always,
    });
    const shown = visibleLabels([label("important", 30, 99), label("looked at", 0, 1, true)], 12);
    expect([...shown]).toEqual(["looked at"]);
  });
});

describe("on screen", () => {
  beforeEach(() => {
    browser();
    mount();
    push.mockClear();
    pathname = "/discover/connections";
    vi.stubGlobal("fetch", () => new Promise(() => {}));
  });
  afterEach(async () => {
    await unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const answer = (results: unknown[]) =>
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ results }) }));
  const one = { kind: "artist", id: "1", name: "Queen", note: "", image: "https://x/330px-q.jpg" };

  it("only the web’s own artist is marked as its middle, and always named", async () => {
    const g = buildGraph(fixture());
    const start = neighborhood(g, ANNA, DEFAULT_CATEGORIES, 9);
    await render(
      <ConnectionExplorer start={start} opened={[]} categories={[...DEFAULT_CATEGORIES]} />,
    );
    const centers = all(".dx-node[data-center]");
    expect(centers.map((n) => n.getAttribute("aria-label"))).toEqual(["Anna"]);
    await click(find('.dx-node[aria-label="Ben"]'));
    const near = all(".dx-node-name[data-near]").map((n) => n.textContent);
    expect(near).toContain("Ben");
    for (const name of near) expect(["Anna", "Ben", "Cara", "Dev"]).toContain(name);
    expect(neighborhood(g, BEN, DEFAULT_CATEGORIES, 9).nodes.map((n) => n.name)).toEqual(
      expect.arrayContaining(near as string[]),
    );
  });

  it("a crowd doesn’t show every name, but always the one chosen", async () => {
    const g = buildGraph(fixture());
    const start = neighborhood(g, ANNA, DEFAULT_CATEGORIES, 9);
    const crowd = Array.from({ length: 50 }, (_, i) => ({
      ...start.nodes[1],
      id: `x${i}`,
      name: `Somebody with a long name ${i}`,
    }));
    const edges = crowd.map(({ id }) => ({ ...start.edges[0], a: start.center, b: id }));
    const web = { ...start, nodes: [...start.nodes, ...crowd], edges: [...start.edges, ...edges] };
    await render(
      <ConnectionExplorer start={web} opened={[]} categories={[...DEFAULT_CATEGORIES]} />,
    );
    const names = () => all(".dx-node-name").map((n) => n.textContent);
    expect(names().length).toBeLessThan(web.nodes.length / 2);
    const hidden = crowd.find(({ name }) => !names().includes(name))!;
    await click(find(`.dx-node[aria-label="${hidden.name}"]`));
    expect(names()).toContain(hidden.name);
    expect(names()).toContain("Anna");
  });

  it("the page you are on is the one highlighted", async () => {
    await render(<DiscoverShell>x</DiscoverShell>);
    expect(all(".nav-option.active").map((n) => n.getAttribute("aria-label"))).toEqual([
      "Collaborators",
    ]);
  });

  it("nothing seems to be loading at first", async () => {
    await render(<DiscoverShell>x</DiscoverShell>);
    expect(find(".dx-progress").hasAttribute("data-on")).toBe(false);
    expect(find(".sidebar").classList.contains("open")).toBe(false);
  });

  it("search shows it is working only while it is", async () => {
    await render(<EntitySearch main label="s" placeholder="" kinds={["artist"]} />);
    expect(box.querySelector(".dx-spin")).toBeNull();
    expect(find("kbd").textContent).toBe("/");
    await type("queen");
    expect(box.querySelector(".dx-spin")).not.toBeNull();
    expect(box.querySelector("kbd")).toBeNull();
    answer([one]);
    await type("queens");
    expect(box.querySelector(".dx-spin")).toBeNull();
  });

  it("only the main search shows its key", async () => {
    await render(<EntitySearch label="s" placeholder="" kinds={["artist"]} />);
    expect(box.querySelector("kbd")).toBeNull();
  });

  it("the choice stays inside a list that got shorter", async () => {
    answer([one, { ...one, id: "2" }, { ...one, id: "3" }]);
    await render(<EntitySearch label="s" placeholder="" kinds={["artist"]} />);
    await type("queen");
    await press(find("input"), "ArrowUp"); // the last of three
    const input = find<HTMLInputElement>("input");
    expect(input.getAttribute("aria-activedescendant")).toBe(all("[role=option]")[2].id);
    answer([one]);
    await type("queen ");
    await settle(500);
    await press(input, "Enter");
    expect(push).toHaveBeenCalledWith("/discover/artist/1");
  });

  it("a section without a note has no empty line for one", async () => {
    await render(<Section title="T">x</Section>);
    expect(all(".dx-section-head p")).toEqual([]);
    await render(
      <Section title="T" note="N">
        x
      </Section>,
    );
    expect(find(".dx-section-head p").textContent).toBe("N");
  });

  it("pictures are decoration: their names are always beside them", async () => {
    await render(
      <>
        <Avatar id="1" name="A" />
        <Cover url="https://x/c.jpg" />
        <Cover />
      </>,
    );
    for (const picture of all(".dx-avatar, .dx-cover"))
      expect(picture.getAttribute("aria-hidden")).toBe("true");
    expect(all("img")).toHaveLength(1);
  });

  it("only closing the share sheet is not a failure", async () => {
    const fail = async (error: unknown) => {
      vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(error) } });
      await render(<ShareButton key={String(error)} label="Share" />);
      await click(find("button"));
      return find("button").textContent;
    };
    expect(await fail(new DOMException("x", "NotAllowedError"))).toBe("Couldn’t copy");
    expect(await fail(Object.assign(new Error("x"), { name: "AbortError" }))).toBe("Couldn’t copy");
    expect(await fail(new DOMException("y", "AbortError"))).toBe("Share");
  });

  it("the form says who it goes around only when it does, and shows photos", async () => {
    const artist: ArtistRef = { id: "2", name: "Two", note: "", listeners: null, photo: one.image };
    const state = {
      from: null,
      to: artist,
      categories: [...DEFAULT_CATEGORIES],
      order: "shortest" as const,
      avoid: [],
    };
    await render(<SixDegreesForm state={state} surprises={[]} />);
    expect(box.textContent).not.toContain("Going around");
    expect(find(".dx-picked img").getAttribute("src")).toContain("/120px-q.jpg");
    await render(<SixDegreesForm state={{ ...state, avoid: [artist] }} surprises={[]} />);
    expect(box.textContent).toContain("Going around");
  });
});
