// @vitest-environment jsdom
// Around You in a browser: looking around, joining a campus, sharing again and leaving.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/discover/around" }));

import type { CommunityView } from "../api";
import AroundYou from "../components/AroundYou";
import { TOP_KEY } from "../lib/account-data";
import { aroundHref, COUNTRIES } from "../lib/places";
import { SERVICES_KEY } from "../lib/services";
import { all, box, click, control, find, mount, render, unmount } from "./dom";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (n: number) => ({ id: id(n), name: `Artist ${n}`, note: "", listeners: null, photo: null });
const view = (over: Partial<CommunityView> = {}): CommunityView => ({
  id: "country:SE",
  kind: "country",
  name: "Sweden",
  members: 6,
  sharing: 5,
  needed: 0,
  chart: [{ artist: person(1), members: 4 }],
  recap: { rose: [{ artist: person(1), from: 3, to: 1 }], fell: [{ artist: person(2), from: 1, to: 2 }], entered: [person(3)], left: [person(4)] },
  joined: false,
  ...over,
});

type Handler = (method: string, url: URL, body: unknown, signal?: AbortSignal | null) => unknown;
let handlers: Record<string, Handler> = {};
let sent: { method: string; url: URL; body: unknown }[] = [];
const settle = () => act(async () => {});

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
  handlers = {};
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://x");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      sent.push({ method, url, body });
      const reply = await handlers[url.pathname](method, url, body, init?.signal);
      if (typeof reply === "number") return { ok: false, status: reply, json: async () => ({ error: `Refused (${reply})` }) };
      return { ok: true, status: 200, json: async () => reply };
    }),
  );
  mount();
});
afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
});

describe("Around You", () => {
  it("lets anyone look around a country's chart, with the week's moves", async () => {
    handlers["/api/discover/communities"] = (_m, url) =>
      url.searchParams.get("id") ? view() : { joined: [], campus: null, signedIn: false };
    await render(<AroundYou countries={COUNTRIES} looking="country:SE" />);
    await settle();
    expect(box.textContent).toContain("Sweden");
    expect(box.textContent).toContain("Country · 6 members, 5 sharing");
    expect(box.textContent).toContain("Artist 14 members");
    expect(box.textContent).toContain("Artist 1, 3 to 1");
    expect(box.textContent).toContain("Artist 2, 1 to 2");
    expect(box.textContent).toContain("New: Artist 3");
    expect(box.textContent).toContain("Left the chart: Artist 4");
    expect(box.textContent).toContain("Sign in on You");
    expect(control("Share this chart")).toBeTruthy();
    expect(all("button").some((b) => b.textContent!.includes("Join"))).toBe(false);
  });

  it("looks around the country picked", async () => {
    handlers["/api/discover/communities"] = () => ({ joined: [], campus: null, signedIn: false });
    await render(<AroundYou countries={COUNTRIES} looking={null} />);
    await settle();
    await act(async () => {
      const select = find<HTMLSelectElement>("select");
      select.value = "JP";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => void find("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(push).toHaveBeenCalledWith(aroundHref("country:JP"));
    expect(COUNTRIES.find(([code]) => code === "JP")![1]).toBe("Japan");
  });

  it("joins your campus with your artists, shares again, and leaves", async () => {
    localStorage.setItem(TOP_KEY, JSON.stringify([{ id: id(9), name: "Fave" }]));
    let joined: CommunityView[] = [];
    handlers["/api/discover/communities"] = (method, url, body) => {
      if (method === "POST") {
        joined = [view({ id: (body as { id: string }).id, kind: "campus", name: "wisc.edu", joined: true, needed: 2, chart: [], recap: null })];
        return joined[0];
      }
      if (method === "DELETE") {
        joined = [];
        return { left: url.searchParams.get("id") };
      }
      return { joined, campus: "campus:wisc.edu", signedIn: true };
    };
    await render(<AroundYou countries={COUNTRIES} looking={null} />);
    await settle();
    expect(box.textContent).toContain("Your account is from wisc.edu.");
    expect(box.textContent).toContain("None yet. Join your campus");
    await click(control("Join wisc.edu and share my artists"));
    await settle();
    expect(sent.find((s) => s.method === "POST")!.body).toEqual({ id: "campus:wisc.edu", artists: [id(9)] });
    expect(box.textContent).toContain("Campus · 6 members");
    expect(box.textContent).toContain("The chart opens when 2 more members share their artists");
    expect(box.textContent).not.toContain("Your account is from");
    await click(control("Share my artists again"));
    await settle();
    expect(sent.filter((s) => s.method === "POST")).toHaveLength(2);
    await click(control("Leave"));
    await settle();
    expect(sent.find((s) => s.method === "DELETE")!.url.searchParams.get("id")).toBe("campus:wisc.edu");
    expect(box.textContent).toContain("Join wisc.edu");
  });

  it("joins a country being looked at, and says when joining fails", async () => {
    handlers["/api/discover/communities"] = (method, url) => {
      if (method === "POST") return 403;
      return url.searchParams.get("id") ? view({ joined: false, recap: null }) : { joined: [view({ id: "campus:a.edu", name: "a.edu", joined: true })], campus: "campus:a.edu", signedIn: true };
    };
    await render(<AroundYou countries={COUNTRIES} looking="country:SE" />);
    await settle();
    expect(box.textContent).toContain("Your communities");
    await click(control("Join and share my artists"));
    await settle();
    expect(box.textContent).toContain("Refused (403)");
  });

  it("waits for listening before joining, and says when Around You isn't set up", async () => {
    localStorage.setItem(SERVICES_KEY, JSON.stringify([{ service: "listenbrainz", user: "rob" }]));
    handlers["/api/discover/listening"] = (_m, _u, _b, signal) =>
      new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    handlers["/api/discover/communities"] = () => ({ joined: [], campus: "campus:a.edu", signedIn: true });
    await render(<AroundYou countries={COUNTRIES} looking={null} />);
    await settle();
    expect(control("Join a.edu and share my artists").hasAttribute("disabled")).toBe(true);
    await unmount();
    mount();
    handlers["/api/discover/communities"] = () => 503;
    await render(<AroundYou countries={COUNTRIES} looking="country:SE" />);
    await settle();
    expect(box.textContent).toContain("Refused (503)");
  });

  it("shows it's loading, and stops asking when it leaves", async () => {
    handlers["/api/discover/communities"] = (_m, _u, _b, signal) =>
      new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    await render(<AroundYou countries={COUNTRIES} looking="country:SE" />);
    expect(box.querySelectorAll("[role=status]")).toHaveLength(2);
    await unmount();
    mount();
    // The chart can arrive before knowing who is looking: no joining until then.
    const pending = handlers["/api/discover/communities"];
    handlers["/api/discover/communities"] = (m, url, b, signal) => (url.searchParams.get("id") ? view() : pending(m, url, b, signal));
    await render(<AroundYou countries={COUNTRIES} looking="country:SE" />);
    await settle();
    expect(box.textContent).toContain("Sweden");
    expect(all("button").some((b) => b.textContent!.includes("Join"))).toBe(false);
  });
});
