// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/discover" }));

import CategoryFilter from "../components/CategoryFilter";
import EntitySearch from "../components/EntitySearch";
import { Avatar } from "../components/parts";
import ShareButton from "../components/ShareButton";
import SixDegreesForm from "../components/SixDegreesForm";
import Tabs from "../components/Tabs";
import { DEFAULT_CATEGORIES, type ArtistRef } from "../lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => {};

let root: Root;
let box: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  push.mockClear();
  box = document.body.appendChild(document.createElement("div"));
  root = createRoot(box);
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (node: ReactNode) => act(async () => root.render(node));
const find = <T extends HTMLElement>(selector: string) => box.querySelector<T>(selector)!;
const press = (element: Element, key: string) =>
  act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
const click = (element: HTMLElement) => act(async () => element.click());

async function type(text: string) {
  const input = find<HTMLInputElement>("input[role=combobox]");
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    input.focus();
    set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => vi.advanceTimersByTimeAsync(500));
}

const RESULTS = [
  { kind: "artist", id: "1", name: "Queen", note: "UK rock group", image: null },
  { kind: "song", id: "2", name: "Queen Bitch", note: "David Bowie" },
];
const answer = (results: unknown, ok = true) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ results }) })),
  );

describe("search", () => {
  const search = (onPick?: () => void) => (
    <EntitySearch label="Find" placeholder="" kinds={["artist", "song"]} onPick={onPick} />
  );
  const options = () => [...box.querySelectorAll<HTMLElement>("[role=option]")];
  const selected = () => options().findIndex((o) => o.getAttribute("aria-selected") === "true");

  it("lists results, marks what matched, and opens one with the keyboard", async () => {
    answer(RESULTS);
    await render(search());
    await type("queen");
    expect(options().map((o) => o.querySelector("strong")!.textContent)).toEqual([
      "Queen",
      "Queen Bitch",
    ]);
    expect(find("mark").textContent).toBe("Queen");
    const input = find("input");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await press(input, "ArrowDown");
    expect(selected()).toBe(1);
    await press(input, "ArrowDown"); // past the last comes the first
    expect(selected()).toBe(0);
    await press(input, "ArrowUp");
    await press(input, "Enter");
    expect(push).toHaveBeenCalledWith("/discover/song/2");
    expect(find<HTMLInputElement>("input").value).toBe("");
  });

  it("asks once for a word typed quickly", async () => {
    answer(RESULTS);
    await render(search());
    await type("queen");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("hands a picked result over instead, when asked to", async () => {
    answer(RESULTS);
    const onPick = vi.fn();
    await render(search(onPick));
    await type("queen");
    await click(options()[0]);
    expect(onPick).toHaveBeenCalledWith(RESULTS[0]);
    expect(push).not.toHaveBeenCalled();
  });

  it("closes with Escape, and says when there is nothing or it failed", async () => {
    answer([]);
    await render(search());
    await type("zzz");
    expect(box.textContent).toContain("Nothing called “zzz” in this catalog.");
    await press(find("input"), "Escape");
    expect(find("input").getAttribute("aria-expanded")).toBe("false");
    answer(null, false);
    await type("other");
    expect(box.textContent).toContain("Search isn’t working right now");
  });
});

describe("tabs", () => {
  const tabs = ["One", "Two", "Three"].map((label) => ({
    key: label,
    label,
    content: <p>{label} panel</p>,
  }));
  const buttons = () => [...box.querySelectorAll<HTMLElement>("[role=tab]")];

  it("show one panel, and move with the arrow, Home and End keys", async () => {
    await render(<Tabs label="Choose" tabs={tabs} />);
    expect(find("[role=tabpanel]").textContent).toBe("One panel");
    await press(buttons()[0], "ArrowLeft");
    expect(find("[role=tabpanel]").textContent).toBe("Three panel");
    expect(document.activeElement).toBe(buttons()[2]);
    await press(buttons()[2], "Home");
    expect(find("[role=tabpanel]").textContent).toBe("One panel");
    expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
  });

  it("fall back to the first when the chosen one goes away, and need no tabs for one panel", async () => {
    await render(<Tabs label="Choose" tabs={tabs} />);
    await click(buttons()[1]);
    await render(<Tabs label="Choose" tabs={[tabs[0], tabs[2]]} />);
    expect(find("[role=tabpanel]").textContent).toBe("One panel");
    await render(<Tabs label="Choose" tabs={[tabs[2]]} />);
    expect(box.textContent).toBe("Three panel");
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
    from: artist("1"),
    to: artist("2"),
    categories: [...DEFAULT_CATEGORIES],
    order: "shortest" as const,
    avoid: [artist("3")],
  };
  const button = (text: string) =>
    [...box.querySelectorAll("button")].find(
      (b) => b.textContent?.includes(text) || b.getAttribute("aria-label")?.includes(text),
    )!;

  it("swaps, forgets an artist to go around, and can surprise", async () => {
    const pairs = [{ from: artist("8"), to: artist("9") }];
    await render(<SixDegreesForm state={state} surprises={pairs} />);
    await click(button("Swap"));
    expect(push.mock.lastCall![0]).toBe("/discover/six-degrees?from=2&to=1&avoid=3");
    await click(button("Allow Artist 3"));
    expect(push.mock.lastCall![0]).toBe("/discover/six-degrees?from=1&to=2");
    await click(button("Surprise me"));
    expect(push.mock.lastCall![0]).toBe("/discover/six-degrees?from=8&to=9");
  });
});

it("the last kind of connection can’t be turned off", async () => {
  const onChange = vi.fn();
  await render(<CategoryFilter value={["bands"]} onChange={onChange} />);
  const boxes = [...box.querySelectorAll<HTMLInputElement>("input")];
  expect(boxes.filter((b) => b.disabled)).toHaveLength(1);
  await click(boxes[0]);
  expect(onChange).toHaveBeenCalledWith(["features", "bands"]);
});

it("sharing copies, says so, and says when it couldn’t", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await render(<ShareButton label="Copy the list" text="Anna - First" />);
  await click(find("button"));
  expect(writeText).toHaveBeenCalledWith("Anna - First");
  expect(find("button").textContent).toBe("Copied");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(find("button").textContent).toBe("Copy the list");
  writeText.mockRejectedValueOnce(new Error("denied"));
  await click(find("button"));
  expect(find("button").textContent).toBe("Couldn’t copy");
});

it("an artist without a photo still has initials", async () => {
  await render(<Avatar id="1" name="The Rolling Stones" />);
  expect(box.textContent).toBe("RS");
  expect(box.querySelector("img")).toBeNull();
});
