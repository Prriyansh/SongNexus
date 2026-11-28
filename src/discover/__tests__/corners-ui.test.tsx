// @vitest-environment jsdom
// Small cases in Discover's controls the other tests don't reach: keys with the list closed,
// wrapping upward, focus moving inside the search, a share sheet without a title, a web with no
// size yet, two fingers on one spot, pressing on an artist, undoing with nothing to undo.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/discover" }));

import ConnectionExplorer from "../components/ConnectionExplorer";
import EntitySearch from "../components/EntitySearch";
import ShareButton from "../components/ShareButton";
import { useWeb } from "../components/useWeb";
import { buildGraph } from "../lib/graph";
import { neighborhood } from "../lib/server";
import { DEFAULT_CATEGORIES, type GraphData } from "../lib/types";
import { all, box, browser, click, find, mount, pointer, render, type, unmount } from "./dom";
import { ANNA, fixture } from "./fixture";

const g = buildGraph(fixture());
const around = (artist: number) => neighborhood(g, artist, DEFAULT_CATEGORIES, 12);

afterEach(async () => {
  await unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the search box", () => {
  const RESULTS = [
    { kind: "artist", id: "1", name: "Queen", note: "" },
    { kind: "song", id: "2", name: "Queen Bitch", note: "" },
  ];
  beforeEach(() => {
    browser();
    mount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: RESULTS }) })));
  });
  const input = () => find<HTMLInputElement>("input");
  const key = async (name: string) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    await act(async () => { input().dispatchEvent(event); });
    return event;
  };
  const selected = () => all("[role=option]").findIndex((o) => o.getAttribute("aria-selected") === "true");

  it("lets Escape do its usual thing when no list is showing", async () => {
    await render(<EntitySearch label="Find" placeholder="" kinds={["artist"]} />);
    expect((await key("Escape")).defaultPrevented).toBe(false);
  });

  it("goes from the first result up to the last, and on up from there", async () => {
    await render(<EntitySearch label="Find" placeholder="" kinds={["artist", "song"]} />);
    await type("queen");
    expect(selected()).toBe(0);
    await key("ArrowUp");
    expect(selected()).toBe(1);
    await key("ArrowUp");
    expect(selected()).toBe(0);
  });

  it("stays open while focus moves within it", async () => {
    await render(<EntitySearch label="Find" placeholder="" kinds={["artist", "song"]} />);
    await type("queen");
    const option = all("[role=option]")[0];
    await act(async () => { input().dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: option })); });
    expect(all("[role=option]")).toHaveLength(2);
  });
});

describe("sharing on a phone", () => {
  it("names the page itself when given no title", async () => {
    browser({ coarse: true });
    mount();
    document.title = "Page title";
    const share = vi.fn(async () => {});
    vi.stubGlobal("navigator", { share, clipboard: { writeText: vi.fn() } });
    await render(<ShareButton label="Share" />);
    await click(find("button"));
    expect(share).toHaveBeenCalledWith({ title: "Page title", url: window.location.href });
  });
});

describe("the web", () => {
  const svg = () => find<SVGSVGElement>("svg[role=group]");
  const view = () => svg().getAttribute("viewBox")!.split(" ").map(Number);
  const explorer = (start: GraphData = around(ANNA)) => <ConnectionExplorer start={start} opened={[]} categories={[...DEFAULT_CATEGORIES]} />;

  it("waits for a size before fitting itself to one", async () => {
    browser({ width: 0, height: 0 });
    mount();
    await render(explorer());
    expect(all(".dx-node").length).toBeGreaterThan(0);
    expect(view().every(Number.isFinite)).toBe(true);
  });

  it("zooms sensibly when two fingers start on the same spot", async () => {
    browser();
    mount();
    await render(explorer());
    await pointer(svg(), "pointerdown", 300, 300, 1);
    await pointer(svg(), "pointerdown", 300, 300, 2);
    await pointer(svg(), "pointermove", 400, 300, 2);
    expect(view().every(Number.isFinite)).toBe(true);
  });

  it("leaves pressing on an artist to the artist", async () => {
    browser();
    mount();
    const capture = vi.spyOn(Element.prototype, "setPointerCapture");
    await render(explorer());
    await pointer(find(".dx-node"), "pointerdown", 10, 10);
    expect(capture).not.toHaveBeenCalled();
  });

  it("counts an artist's connections when there's nothing else to say about them", async () => {
    browser();
    mount();
    const data = around(ANNA);
    await render(explorer({ ...data, nodes: data.nodes.map((n) => ({ ...n, note: "" })) }));
    expect(find(".dx-picked small").textContent).toBe("3 connections");
  });

  it("has nothing to undo before anything was opened", async () => {
    browser();
    mount();
    let web: ReturnType<typeof useWeb> | undefined;
    function Probe() {
      web = useWeb(around(ANNA), []);
      return null;
    }
    await render(<Probe />);
    expect(web!.canUndo).toBe(false);
    expect(web!.undo()).toBeNull();
    expect(box).toBeDefined();
  });
});
