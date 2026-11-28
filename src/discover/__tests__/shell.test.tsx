// @vitest-environment jsdom
// The frame around every page, and the controls that aren't covered by components.test.tsx.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let pathname = "/discover";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => pathname }));

import DiscoverError from "@/app/discover/error";
import { neighborhood, reasons, search } from "../api";
import DiscoverShell from "../components/DiscoverShell";
import EntitySearch from "../components/EntitySearch";
import ShareButton from "../components/ShareButton";
import SixDegreesForm from "../components/SixDegreesForm";
import Tabs from "../components/Tabs";
import { DEFAULT_CATEGORIES, type ArtistRef } from "../lib/types";
import {
  all,
  box,
  browser,
  click,
  control,
  find,
  mount,
  press,
  render,
  settle,
  type,
  unmount,
} from "./dom";

beforeEach(() => {
  browser();
  mount();
  push.mockClear();
  pathname = "/discover";
  window.history.replaceState(null, "", "/discover");
});

afterEach(async () => {
  await unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const answerWith = (results: unknown[]) =>
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ results }) }));

const ELSEWHERE = "/discover/artist/x";

describe("the frame", () => {
  const open = () => find(".sidebar").classList.contains("open");
  const working = () => find(".dx-progress").hasAttribute("data-on");
  const shell = (
    <DiscoverShell>
      <a href={ELSEWHERE}>In Discover</a>
      <a href="/discover" id="here">
        Here
      </a>
      <a href="/discover/artist/y" target="_blank" id="new" rel="noreferrer">
        New tab
      </a>
      <a href="https://musicbrainz.org" id="out">
        Away
      </a>
    </DiscoverShell>
  );
  // jsdom can't navigate; what is under test happens before it would.
  const stay = (event: Event) => event.preventDefault();
  beforeEach(() => document.addEventListener("click", stay));
  afterEach(() => document.removeEventListener("click", stay));

  it("opens the menu on its close button, and closes by it, the backdrop or Escape", async () => {
    await render(shell);
    const menu = control("Open navigation");
    for (const close of [
      () => click(control("Close navigation")),
      () => click(find(".sidebar-backdrop")),
      () => press(document.body, "Escape"),
    ]) {
      menu.focus();
      await click(menu);
      expect(open()).toBe(true);
      expect(menu.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(control("Close navigation"));
      await close();
      expect(open()).toBe(false);
      expect(document.activeElement).toBe(menu);
    }
    await click(menu);
    await press(document.body, "a");
    expect(open()).toBe(true);
  });

  it("shows progress only while going to another Discover page in this tab", async () => {
    await render(shell);
    for (const id of ["#here", "#new", "#out"]) {
      await click(find(id));
      expect(working()).toBe(false);
    }
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
      await click(control("In Discover"), { [modifier]: true });
      expect(working()).toBe(false);
    }
    await click(control("In Discover"), { button: 1 });
    expect(working()).toBe(false);
    await click(control("In Discover"));
    expect(working()).toBe(true);
    pathname = "/discover/artist/x";
    await render(<DiscoverShell>arrived</DiscoverShell>);
    expect(working()).toBe(false);
  });

  it("marks where you are", async () => {
    pathname = "/discover/connections";
    await render(shell);
    expect(find("[aria-current=page]").getAttribute("aria-label")).toBe("Collaborators");
    expect(find(".topbar-left strong").textContent).toBe("Collaborators");
    pathname = "/somewhere";
    await render(<DiscoverShell>x</DiscoverShell>);
    expect(find(".topbar-left strong").textContent).toBe("Discover");
  });
});

describe("a failed page", () => {
  it("logs why, and tries again", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const error = new Error("broken");
    await render(<DiscoverError error={error} retry={retry} />);
    expect(log).toHaveBeenCalledWith(error);
    await click(control("Try again"));
    expect(retry).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});

describe("the browser’s side of the API", () => {
  const answer = (body: unknown, ok = true) => {
    const fetch = vi.fn(async (...args: [string, RequestInit?]) => {
      void args;
      return { ok, status: ok ? 200 : 503, json: async () => body };
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };

  it("sends names safely, and unwraps the results", async () => {
    const fetch = answer({ results: ["x"] });
    expect(await search("AC/DC & you?", "artist,song")).toEqual(["x"]);
    expect(fetch.mock.lastCall![0]).toBe(
      "/api/discover/search?q=AC%2FDC+%26+you%3F&kinds=artist%2Csong",
    );
  });

  it("asks for connections and reasons, and can be called off", async () => {
    const fetch = answer({});
    const { signal } = new AbortController();
    await neighborhood("a1", ["bands", "samples"], 5, signal);
    expect(fetch.mock.lastCall).toEqual([
      "/api/discover/neighborhood?artist=a1&categories=bands%2Csamples&limit=5",
      { signal },
    ]);
    await reasons("a1", "b2", ["bands"]);
    expect(fetch.mock.lastCall![0]).toBe("/api/discover/reasons?a=a1&b=b2&categories=bands");
  });

  it("fails loudly on a bad answer", async () => {
    answer({}, false);
    await expect(search("x", "artist")).rejects.toThrow("Discover search failed (503)");
  });
});

describe("the main search", () => {
  const main = (
    <EntitySearch main label="Search" placeholder="" kinds={["artist", "song", "label", "genre"]} />
  );

  it("takes the / key, unless you are typing or holding another key", async () => {
    await render(
      <>
        <textarea />
        {main}
      </>,
    );
    const input = find("input");
    find("textarea").focus();
    await press(find("textarea"), "/");
    expect(document.activeElement).not.toBe(input);
    const held = new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true });
    await act(async () => void document.body.dispatchEvent(held));
    expect(document.activeElement).not.toBe(input);
    expect((await press(document.body, "/")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    await render(<p>gone</p>);
    expect((await press(document.body, "/")).defaultPrevented).toBe(false);
  });

  it("shows what each result is, follows the mouse, clears, and closes when left", async () => {
    answerWith([
      { kind: "artist", id: "1", name: "Pop Artist", note: "note", image: "https://x/330px-a.jpg" },
      { kind: "song", id: "2", name: "Pop Song", note: "", image: "https://y/c.jpg" },
      { kind: "label", id: "3", name: "Pop Label", note: "" },
      { kind: "genre", id: "pop", name: "pop", note: "" },
    ]);
    await render(main);
    await type("pop");
    const notes = all("[role=option] small").map((s) => s.textContent);
    expect(notes).toEqual(["Artist · note", "Song", "Label", "Genre"]);
    expect(all("[role=option] img")).toHaveLength(2);
    expect(find("p[role=status]").textContent).toBe("4 results");
    const third = all("[role=option]")[2];
    await act(async () => void third.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
    expect(third.getAttribute("aria-selected")).toBe("true");
    expect(find("input").getAttribute("aria-activedescendant")).toBe(third.id);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => void third.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true); // the box keeps its focus
    await click(control("Clear"));
    expect(find<HTMLInputElement>("input").value).toBe("");
    expect(document.activeElement).toBe(find("input"));
    await type("pop");
    await act(async () => find("input").blur());
    expect(find("input").getAttribute("aria-expanded")).toBe("false");
    await act(async () => find("input").focus());
    expect(find("input").getAttribute("aria-expanded")).toBe("true");
  });

  it("never shows an older answer for a newer word", async () => {
    const finish: ((results: unknown[]) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      (_: string, { signal }: RequestInit) =>
        new Promise((resolve, reject) => {
          signal!.addEventListener("abort", () => reject(new DOMException("", "AbortError")));
          finish.push((results) => resolve({ ok: true, json: async () => ({ results }) }));
        }),
    );
    await render(main);
    await type("que");
    await type("queen");
    finish[1]([{ kind: "artist", id: "2", name: "Queen", note: "" }]);
    finish[0]([{ kind: "artist", id: "1", name: "Que", note: "" }]);
    await settle();
    expect(all("[role=option] strong").map((s) => s.textContent)).toEqual(["Queen"]);
    expect(box.textContent).not.toContain("isn’t working");
  });

  it("does nothing with Enter before there are results, or after Escape", async () => {
    answerWith([{ kind: "artist", id: "1", name: "Queen", note: "" }]);
    await render(main);
    await press(find("input"), "Enter");
    await type("queen");
    await press(find("input"), "Escape");
    await press(find("input"), "Enter");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("sharing a page", () => {
  it("copies its address on a computer", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText }, share: vi.fn() });
    await render(<ShareButton label="Share" />);
    await click(find("button"));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  it("uses the share sheet on a phone, and closing it isn’t a failure", async () => {
    await unmount();
    browser({ coarse: true });
    mount();
    const share = vi.fn(async () => {});
    vi.stubGlobal("navigator", { share, clipboard: { writeText: vi.fn() } });
    await render(<ShareButton label="Share" title="ABBA" />);
    await click(find("button"));
    expect(share).toHaveBeenCalledWith({ title: "ABBA", url: window.location.href });
    share.mockRejectedValueOnce(new DOMException("closed", "AbortError"));
    await click(find("button"));
    expect(find("button").textContent).toBe("Share");
    share.mockRejectedValueOnce(new Error("no"));
    await click(find("button"));
    expect(find("button").textContent).toBe("Couldn’t copy");
  });
});

describe("Six Degrees’ form", () => {
  const artist = (id: string): ArtistRef => ({
    id,
    name: `Artist ${id}`,
    note: "",
    listeners: null,
    photo: null,
  });
  const state = {
    from: null,
    to: artist("2"),
    categories: [...DEFAULT_CATEGORIES],
    order: "shortest" as const,
    avoid: [],
  };
  const both = { ...state, from: artist("1") };

  it("fills an empty end, and changes or keeps a filled one", async () => {
    answerWith([{ kind: "artist", id: "7", name: "Seven", note: "n", image: null }]);
    await render(<SixDegreesForm state={state} surprises={[]} />);
    await type("seven");
    await click(find("[role=option]"));
    expect(push.mock.lastCall![0]).toBe("/discover/six-degrees?from=7&to=2");
    await click(control("Change Artist 2"));
    expect(all("input[role=combobox]")).toHaveLength(2);
    await click(control("Keep Artist 2"));
    expect(all("input[role=combobox]")).toHaveLength(1);
  });

  it("changes the order and what counts", async () => {
    await render(<SixDegreesForm state={both} surprises={[]} />);
    await act(async () => all<HTMLInputElement>("input[type=radio]")[1].click());
    expect(push.mock.lastCall![0]).toBe("/discover/six-degrees?from=1&to=2&order=strongest");
    await act(async () => find<HTMLInputElement>("[data-category=engineering] input").click());
    expect(push.mock.lastCall![0]).toContain("engineering");
  });

  it("never surprises with the pair already shown, or with nothing", async () => {
    const shown = { from: artist("1"), to: artist("2") };
    const other = { from: artist("3"), to: artist("4") };
    await render(<SixDegreesForm state={both} surprises={[shown]} />);
    await click(control("Surprise me"));
    expect(push).not.toHaveBeenCalled();
    await render(<SixDegreesForm state={both} surprises={[shown, other]} />);
    for (let i = 0; i < 8; i++) await click(control("Surprise me"));
    const hrefs = new Set(push.mock.calls.map(([href]) => href));
    expect(hrefs).toEqual(new Set(["/discover/six-degrees?from=3&to=4"]));
  });

  it("can’t swap nothing", async () => {
    await render(<SixDegreesForm state={{ ...state, to: null }} surprises={[]} />);
    expect(control("Swap the two artists").hasAttribute("disabled")).toBe(true);
  });
});

it("tabs with nothing in them are nothing, and other keys are left alone", async () => {
  await render(<Tabs label="x" tabs={[]} />);
  expect(box.innerHTML).toBe("");
  const tabs = ["a", "b"].map((key) => ({ key, label: key, content: key }));
  await render(<Tabs label="x" tabs={tabs} />);
  expect((await press(find("[role=tab]"), "x")).defaultPrevented).toBe(false);
  await press(find("[role=tab]"), "End");
  expect(find("[role=tabpanel]").textContent).toBe("b");
  await press(all("[role=tab]")[1], "ArrowRight");
  expect(find("[role=tabpanel]").textContent).toBe("a");
});
