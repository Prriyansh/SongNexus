// @vitest-environment jsdom
// Moving between stories with keys and swipes.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/discover" }));

import StoryKeys from "../components/StoryKeys";
import { box, mount, press, render, unmount } from "./dom";

beforeEach(() => {
  push.mockClear();
  mount();
});
afterEach(unmount);

const swipe = (from: [number, number], to: [number, number], pointerType = "touch") =>
  act(async () => {
    for (const [type, [x, y]] of [["pointerdown", from], ["pointerup", to]] as const) {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.assign(event, { pointerType });
      document.body.dispatchEvent(event);
    }
  });

describe("moving between stories", () => {
  it("follows the arrow and page keys", async () => {
    await render(<StoryKeys previous="/p" next="/n" />);
    await press(document.body, "ArrowRight");
    await press(document.body, "PageDown");
    await press(document.body, "ArrowLeft");
    await press(document.body, "PageUp");
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
    expect(push.mock.calls.map(([href]) => href)).toEqual(["/n", "/n", "/p", "/p", "/n"]);
    expect(push).toHaveBeenCalledWith("/n", { scroll: false });
  });

  it("leaves other keys, shortcuts, handled keys and typing alone", async () => {
    await render(<StoryKeys previous="/p" next="/n" />);
    const input = box.appendChild(document.createElement("input"));
    await press(input, "ArrowRight");
    await press(document.body, "Enter");
    for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
      await act(async () => {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, [modifier]: true }));
      });
    }
    const handled = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    handled.preventDefault();
    await act(async () => void document.body.dispatchEvent(handled));
    expect(push).not.toHaveBeenCalled();
  });

  it("does nothing at either end", async () => {
    await render(<StoryKeys previous={null} next={null} />);
    await press(document.body, "ArrowRight");
    await press(document.body, "ArrowLeft");
    await swipe([300, 100], [100, 100]);
    expect(push).not.toHaveBeenCalled();
  });

  it("follows a long sideways swipe on a touch screen", async () => {
    await render(<StoryKeys previous="/p" next="/n" />);
    await swipe([300, 100], [100, 110]);
    await swipe([100, 100], [300, 90]);
    expect(push.mock.calls.map(([href]) => href)).toEqual(["/n", "/p"]);
  });

  it("ignores short or upright swipes, the mouse, and a lift without a touch", async () => {
    await render(<StoryKeys previous="/p" next="/n" />);
    await swipe([300, 100], [260, 100]);
    await swipe([300, 100], [200, 300]);
    await swipe([300, 100], [100, 100], "mouse");
    await act(async () => {
      const up = new MouseEvent("pointerup", { bubbles: true, clientX: 0 });
      Object.assign(up, { pointerType: "touch" });
      document.body.dispatchEvent(up);
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("stops listening when the story leaves", async () => {
    await render(<StoryKeys previous="/p" next="/n" />);
    await unmount();
    mount();
    await press(document.body, "ArrowRight");
    expect(push).not.toHaveBeenCalled();
  });
});
