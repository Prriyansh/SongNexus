// @vitest-environment jsdom
// A question typed into Discover's search can be asked instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/discover" }));

import EntitySearch from "../components/EntitySearch";
import { box, find, mount, press, render, type, unmount } from "./dom";

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = () => {};
  push.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) })));
  mount();
});
afterEach(async () => {
  await unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("asking from search", () => {
  it("offers to ask a question that matches no name, and asks it on Enter", async () => {
    await render(<EntitySearch label="Search" placeholder="" kinds={["artist"]} />);
    await type("who produced Umbrella");
    expect(box.textContent).toContain("No name matches. Ask it as a question");
    expect(find("a").getAttribute("href")).toBe("/discover/ask?q=who%20produced%20Umbrella");
    await press(find("input"), "Enter");
    expect(push).toHaveBeenCalledWith("/discover/ask?q=who%20produced%20Umbrella");
  });

  it("keeps a plain search's message, and pickers never ask", async () => {
    await render(<EntitySearch label="Search" placeholder="" kinds={["artist"]} />);
    await type("Nobodyatall");
    expect(box.textContent).toContain("Nothing called “Nobodyatall” in this catalog.");
    await press(find("input"), "Enter");
    await render(<EntitySearch label="Pick" placeholder="" kinds={["artist"]} onPick={() => {}} />);
    await type("who produced Umbrella");
    expect(box.textContent).toContain("Nothing called “who produced Umbrella” in this catalog.");
    await press(find("input"), "Enter");
    expect(push).not.toHaveBeenCalled();
  });
});
