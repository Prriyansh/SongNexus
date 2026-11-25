// A page in jsdom: rendering, typing, clicking, and the browser parts jsdom leaves out.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
export let box: HTMLElement;

export function mount() {
  box = document.body.appendChild(document.createElement("div"));
  root = createRoot(box);
}

export async function unmount() {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
}

export const render = (node: ReactNode) => act(async () => root!.render(node));

export function find<T extends Element = HTMLElement>(selector: string): T {
  const found = box.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

export const all = <T extends Element = HTMLElement>(selector: string) => [
  ...box.querySelectorAll<T>(selector),
];

/** A button or link by its words or its label. */
export function control(name: string): HTMLElement {
  const found = all("button, a").find(
    (e) => e.getAttribute("aria-label") === name || e.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no control called ${name}`);
  return found;
}

export const click = (element: Element, init: MouseEventInit = {}) =>
  act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  });

export const doubleClick = (element: Element) =>
  act(async () => {
    element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  });

export async function press(element: Element, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => void element.dispatchEvent(event));
  return event;
}

export const pointer = (element: Element, type: string, x: number, y: number, id = 1) =>
  act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.assign(event, { pointerId: id, pointerType: "mouse" });
    element.dispatchEvent(event);
  });

export async function wheel(element: Element, deltaY: number) {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  await act(async () => void element.dispatchEvent(event));
  return event;
}

/** Lets promises settle and timers up to now run. */
export const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

export async function type(text: string) {
  const input = find<HTMLInputElement>("input[role=combobox]");
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    input.focus();
    set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(500);
}

/** What jsdom doesn't have. `still` is whether the viewer asked for less motion. */
export function browser({ still = true, coarse = false, width = 800, height = 600 } = {}) {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced-motion") ? still : coarse,
  }));
  window.matchMedia = globalThis.matchMedia;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private tell: (entries: unknown[]) => void) {}
      observe() {
        this.tell([{ contentRect: { width, height } }]);
      }
      disconnect() {}
    },
  );
}
