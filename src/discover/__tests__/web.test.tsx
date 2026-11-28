// @vitest-environment jsdom
// The connection web as someone uses it: pointing, opening, undoing, moving, zooming, sharing.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/discover" }));

import ConnectionExplorer from "../components/ConnectionExplorer";
import ExplorerBar from "../components/ExplorerBar";
import { buildGraph } from "../lib/graph";
import { MAX_NODES } from "../lib/layout";
import { neighborhood } from "../lib/server";
import { DEFAULT_CATEGORIES, type GraphData } from "../lib/types";
import {
  all,
  browser,
  box,
  click,
  control,
  doubleClick,
  find,
  mount,
  pointer,
  press,
  render,
  settle,
  type,
  unmount,
  wheel,
} from "./dom";
import { ANNA, artistId, BEN, CARA, DEV, fixture } from "./fixture";

const g = buildGraph(fixture());
const around = (artist: number) => neighborhood(g, artist, DEFAULT_CATEGORIES, 12);
const categories = [...DEFAULT_CATEGORIES];
const REASONS = {
  reasons: [{ category: "features", text: "They made “First”", subject: null, year: 2001 }],
  total: 3,
};

type Answer = { ok?: boolean; body?: unknown };
let answers: Record<string, (url: URL) => Answer | Promise<Answer>>;
const asked: URL[] = [];
const opens = () => asked.filter((u) => u.pathname.endsWith("neighborhood"));

beforeEach(() => {
  browser();
  mount();
  push.mockClear();
  asked.length = 0;
  answers = {
    neighborhood: (url) => ({
      body: around(g.catalog.artistAt.get(url.searchParams.get("artist")!)!),
    }),
    reasons: () => ({ body: REASONS }),
    search: () => ({
      body: { results: [{ kind: "artist", id: artistId(BEN), name: "Ben", note: "" }] },
    }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (address: string, init?: RequestInit) => {
      const url = new URL(address, "http://x");
      asked.push(url);
      const { ok = true, body } = await answers[url.pathname.split("/").pop()!](url);
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return { ok, status: ok ? 200 : 500, json: async () => body };
    }),
  );
  window.history.replaceState(null, "", "/discover/connections");
});

afterEach(async () => {
  await unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const explorer = (start: GraphData = around(ANNA), opened: GraphData[] = []) => (
  <ConnectionExplorer start={start} opened={opened} categories={categories} />
);
const node = (name: string) => find<SVGGElement>(`.dx-node[aria-label="${name}"]`);
const labels = (selector: string) => all(selector).map((n) => n.getAttribute("aria-label"));
const names = () => labels(".dx-node");
const chosen = () => find(".dx-node[data-selected]").getAttribute("aria-label");
const svg = () => find<SVGSVGElement>("svg[role=group]");
const view = () => svg().getAttribute("viewBox")!.split(" ").map(Number);
const side = () => find(".dx-side").textContent!;

describe("looking around", () => {
  it("starts on its artist, with everyone they are closest to", async () => {
    await render(explorer());
    expect(names().sort()).toEqual(["Anna", "Ben", "Cara", "Dev"]);
    expect(chosen()).toBe("Anna");
    expect(side()).toContain("Closest of 3 connections");
    expect(asked).toEqual([]); // nothing to explain yet
  });

  it("explains a choice, with the starting artist where they met", async () => {
    await render(explorer());
    await click(node("Ben"));
    await settle();
    expect(side()).toContain("With Anna");
    expect(side()).toContain("They made “First”2001and 2 more credits");
    expect(asked[0].searchParams.get("a")).toBe(artistId(ANNA));
    expect(asked[0].searchParams.get("b")).toBe(artistId(BEN));
  });

  it("shows that the credits are on their way", async () => {
    answers.reasons = () => new Promise(() => {});
    await render(explorer());
    await click(node("Ben"));
    expect(find(".dx-bones").getAttribute("aria-label")).toBe("Loading credits");
  });

  it("explains with the closest artist in view, for someone the starting one never met", async () => {
    await render(explorer(around(ANNA), [around(DEV)]));
    await click(node("The Eve Band"));
    await settle();
    expect(side()).toContain("With Dev");
  });

  it("chooses from the list too", async () => {
    await render(explorer());
    await click(all(".dx-side-list button").find((b) => b.textContent!.includes("Cara"))!);
    expect(chosen()).toBe("Cara");
  });

  it("says when the credits don’t load", async () => {
    answers.reasons = () => ({ ok: false });
    await render(explorer());
    await click(node("Ben"));
    await settle();
    expect(side()).toContain("The credits didn’t load.");
  });

  it("ignores an answer that comes too late", async () => {
    let late: (a: Answer) => void = () => {};
    answers.reasons = () => new Promise((resolve) => (late = resolve));
    await render(explorer());
    await click(node("Cara"));
    answers.reasons = () => ({ body: { ...REASONS, total: 1 } });
    await click(node("Dev"));
    late({ body: { reasons: [{ ...REASONS.reasons[0], text: "Too late" }], total: 1 } });
    await settle();
    expect(side()).not.toContain("Too late");
    expect(side()).toContain("They made “First”");
  });

  it("lights up the neighborhood under the mouse, without choosing it", async () => {
    await render(explorer(around(ANNA), [around(DEV)]));
    await pointer(node("The Eve Band"), "pointerover", 10, 10);
    expect(svg().hasAttribute("data-focused")).toBe(true);
    expect(labels(".dx-node[data-near]").sort()).toEqual(["Dev", "The Eve Band"]);
    expect(chosen()).toBe("Anna");
    await pointer(node("The Eve Band"), "pointerout", 10, 10);
    expect(svg().hasAttribute("data-focused")).toBe(false);
  });

  it("offers the artist’s page and the path from here", async () => {
    await render(explorer());
    await click(node("Dev"));
    expect(control("Artist page").getAttribute("href")).toBe(`/discover/artist/${artistId(DEV)}`);
    expect(control("Six Degrees").getAttribute("href")).toBe(
      `/discover/six-degrees?from=${artistId(ANNA)}&to=${artistId(DEV)}`,
    );
    await click(node("Anna"));
    expect(() => control("Six Degrees")).toThrow();
  });
});

describe("opening", () => {
  it("adds an artist’s connections and remembers it in the address", async () => {
    await render(explorer());
    await click(node("Dev"));
    await click(control("Open their connections"));
    await settle();
    expect(names()).toContain("The Eve Band");
    expect(window.location.search).toBe(`?artist=${artistId(ANNA)}&open=${artistId(DEV)}`);
    expect(() => control("Open their connections")).toThrow(); // it is open
  });

  it("works by double click, and only once per artist", async () => {
    await render(explorer());
    await doubleClick(node("Dev"));
    await settle();
    await doubleClick(node("Dev"));
    await settle();
    expect(opens()).toHaveLength(1);
  });

  it("doesn’t start another while one is loading", async () => {
    let finish: (a: Answer) => void = () => {};
    answers.neighborhood = () => new Promise((resolve) => (finish = resolve));
    await render(explorer());
    await doubleClick(node("Dev"));
    expect(node("Dev").hasAttribute("data-opening")).toBe(true);
    expect(control("Opening…").hasAttribute("disabled")).toBe(true);
    await doubleClick(node("Ben"));
    finish({ body: around(DEV) });
    await settle();
    expect(opens()).toHaveLength(1);
    expect(all("[data-opening]")).toEqual([]);
  });

  it("says when it fails, and can be tried again", async () => {
    answers.neighborhood = () => ({ ok: false });
    await render(explorer());
    await doubleClick(node("Dev"));
    await settle();
    expect(find("[role=alert]").textContent).toBe("The connections of Dev didn’t load. Try again.");
    answers.neighborhood = () => ({ body: around(DEV) });
    await click(control("Open their connections"));
    await settle();
    expect(box.querySelector("[role=alert]")).toBeNull();
    expect(names()).toContain("The Eve Band");
  });

  it("can be undone, back to the web and address before", async () => {
    await render(explorer());
    expect(control("Undo").hasAttribute("disabled")).toBe(true);
    await doubleClick(node("Dev"));
    await settle();
    await click(node("The Eve Band"));
    await click(control("Undo"));
    expect(names()).not.toContain("The Eve Band");
    expect(chosen()).toBe("Anna"); // the choice left with the web
    expect(window.location.search).toBe(`?artist=${artistId(ANNA)}`);
    expect(control("Undo").hasAttribute("disabled")).toBe(true);
  });

  it("stops when the web is full", async () => {
    const start = around(ANNA);
    const extra = Array.from({ length: MAX_NODES }, (_, i) => ({
      ...start.nodes[1],
      id: `x${i}`,
      name: `X${i}`,
    }));
    const ben = around(BEN);
    await render(explorer(start, [{ ...ben, nodes: [...ben.nodes, ...extra] }]));
    expect(names()).toHaveLength(MAX_NODES);
    expect(side()).toContain(`This web is full (${MAX_NODES} artists)`);
    await doubleClick(node("Dev"));
    await settle();
    expect(opens()).toEqual([]);
  });

  it("rebuilds a shared web", async () => {
    await render(explorer(around(ANNA), [around(DEV), around(CARA)]));
    expect(labels("[data-opened]").sort()).toEqual(["Anna", "Cara", "Dev"]);
  });
});

describe("moving", () => {
  it("glides to a new layout when motion is welcome", async () => {
    await unmount();
    browser({ still: false });
    mount();
    await render(explorer());
    const before = view();
    await doubleClick(node("Dev"));
    await settle(60);
    const during = view();
    expect(names()).toContain("The Eve Band"); // there from the first frame
    await settle(1500);
    const after = view();
    expect(during).not.toEqual(after);
    expect(after).not.toEqual(before);
    await settle(1500);
    expect(view()).toEqual(after); // and stays
  });

  it("zooms with the wheel around the pointer, without scrolling the page", async () => {
    await render(explorer());
    const start = view();
    const event = await wheel(svg(), -100);
    expect(event.defaultPrevented).toBe(true);
    expect(view()[2]).toBeLessThan(start[2]);
    await wheel(svg(), 100);
    view().forEach((value, i) => expect(value).toBeCloseTo(start[i], 3));
  });

  it("zooms and fits with the buttons", async () => {
    await render(explorer());
    const start = view();
    await click(control("Zoom in"));
    expect(view()[2]).toBeLessThan(start[2]);
    await click(control("Zoom out"));
    expect(view()[2]).toBeCloseTo(start[2], 3);
    await click(control("Zoom in"));
    await click(control("Show everyone"));
    expect(view()).toEqual(start);
  });

  it("drags by the background, and stops on release", async () => {
    await render(explorer());
    const [x, , width, height] = view();
    const scale = Math.max(width / 800, height / 600);
    await pointer(svg(), "pointerdown", 100, 100);
    await pointer(svg(), "pointermove", 140, 100);
    expect(view()[0]).toBeCloseTo(x - 40 * scale, 3);
    await pointer(svg(), "pointerup", 140, 100);
    await pointer(svg(), "pointermove", 300, 100);
    expect(view()[0]).toBeCloseTo(x - 40 * scale, 3);
  });

  it("pinches with two fingers", async () => {
    await render(explorer());
    const width = view()[2];
    await pointer(svg(), "pointerdown", 300, 300, 1);
    await pointer(svg(), "pointerdown", 400, 300, 2);
    await pointer(svg(), "pointermove", 500, 300, 2); // twice as far apart
    expect(view()[2]).toBeCloseTo(width / 2, 3);
    await pointer(svg(), "pointercancel", 500, 300, 2);
    await pointer(svg(), "pointerup", 300, 300, 1);
  });

  it("walks with the arrow keys, opens with Enter, and zooms with plus, minus and zero", async () => {
    await render(explorer());
    const start = view();
    const seen = new Set<string | null>();
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowRight"]) {
      await press(svg(), key);
      seen.add(chosen());
    }
    expect(seen.size).toBeGreaterThan(1);
    await press(svg(), "+");
    expect(view()[2]).toBeLessThan(start[2]);
    await press(svg(), "0");
    expect(view()).toEqual(start);
    await press(svg(), "-");
    expect(view()[2]).toBeGreaterThan(start[2]);
    await click(node("Dev"));
    await press(svg(), "Enter");
    await settle();
    expect(names()).toContain("The Eve Band");
    expect((await press(svg(), "Tab")).defaultPrevented).toBe(false); // other keys are left alone
  });

  it("is one stop for the Tab key", async () => {
    await render(explorer());
    const stops = all(".dx-node").filter((n) => n.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
  });
});

describe("drawing", () => {
  it("shows photos where there are some, initials where not, and a legend of what it uses", async () => {
    await render(explorer());
    expect(find("image").getAttribute("href")).toContain("/120px-Anna.jpg");
    expect(node("Ben").textContent).toContain("B");
    expect(all(".dx-legend li").map((l) => l.textContent)).toContain("Production");
    expect(all(".dx-edge").length).toBe(around(ANNA).edges.length);
  });

  it("always names the starting artist and the one looked at", async () => {
    await render(explorer());
    await click(node("Dev"));
    const shown = all(".dx-node-name").map((n) => n.textContent);
    expect(shown).toEqual(expect.arrayContaining(["Anna", "Dev"]));
  });

  it("stops listening when it goes away", async () => {
    await render(explorer());
    const element = svg();
    await render(<p>gone</p>);
    expect((await wheel(element, -100)).defaultPrevented).toBe(false);
  });
});

describe("the bar above the web", () => {
  it("starts from another artist, keeping what counts", async () => {
    await render(<ExplorerBar artist={artistId(ANNA)} categories={["bands"]} />);
    await type("ben");
    await click(find("[role=option]"));
    expect(push.mock.lastCall![0]).toBe(`/discover/connections?artist=${artistId(BEN)}&via=bands`);
  });

  it("changes what counts, keeping the artist", async () => {
    await render(<ExplorerBar artist={artistId(ANNA)} categories={["bands"]} />);
    await act(async () => find<HTMLInputElement>("[data-category=features] input").click());
    expect(push.mock.lastCall![0]).toBe(
      `/discover/connections?artist=${artistId(ANNA)}&via=features%2Cbands`,
    );
  });
});
