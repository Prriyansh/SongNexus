// @vitest-environment jsdom
// Library and Friend paths in a browser: connecting services, listening, Your Nexus, sharing and
// comparing with a friend.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/discover/library" }));

import { listening } from "../api";
import FriendPaths, { friendHref } from "../components/FriendPaths";
import Library from "../components/Library";
import { myArtists } from "../components/useListening";
import { connectedIn, SERVICES_KEY } from "../lib/services";
import { PROFILE_KEY } from "../lib/stored";
import type { ArtistRef } from "../lib/types";
import { all, box, click, control, find, mount, render, unmount } from "./dom";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (n: number, name: string): ArtistRef => ({ id: id(n), name, note: `note ${n}`, listeners: null, photo: null });
const [ADELE, DRAKE, HUB, FRIEND] = [person(1, "Adele"), person(2, "Drake"), person(3, "Hub"), person(4, "Friend’s artist")];
const reason = (text: string) => ({ category: "features" as const, text, subject: null, year: null });

type Handler = (url: URL, signal?: AbortSignal | null) => unknown;
let handlers: Record<string, Handler> = {};
const never: Handler = (_u, signal) =>
  new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
const settle = () => act(async () => {});

beforeEach(() => {
  localStorage.clear();
  handlers = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://x");
      const reply = await handlers[url.pathname](url, init?.signal);
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

const connect = (...list: [string, string][]) =>
  localStorage.setItem(SERVICES_KEY, JSON.stringify(list.map(([service, user]) => ({ service, user }))));
const typeInto = (input: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = (form: Element) =>
  act(async () => void form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

describe("errors from the server", () => {
  it("use the server's words, or say which call failed when there are none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => Promise.reject(new Error("not JSON")) })));
    await expect(listening("listenbrainz", "rob")).rejects.toThrow("Discover listening failed (502)");
  });
});

describe("my artists", () => {
  it("takes each service's most played in turn, then favourites, each once", () => {
    const connected = connectedIn(JSON.stringify([{ service: "listenbrainz", user: "a" }, { service: "lastfm", user: "bb" }, { service: "deezer", user: "1" }]));
    const heard = {
      "listenbrainz:a": { artists: [{ name: "Adele", plays: 3, artist: ADELE }, { name: "Gone", plays: 1, artist: null }, { name: "Hub", plays: 1, artist: HUB }] },
      "lastfm:bb": { artists: [{ name: "Drake", plays: 9, artist: DRAKE }] },
      "deezer:1": { error: "private" },
    };
    expect(myArtists(connected, heard, [HUB.id, FRIEND.id])).toEqual([ADELE.id, DRAKE.id, HUB.id, FRIEND.id]);
    expect(myArtists([], {}, [])).toEqual([]);
  });
});

describe("Library", () => {
  it("connects a service by username, and refuses names the service couldn't have", async () => {
    handlers["/api/discover/listening"] = () => ({ artists: [] });
    await render(<Library />);
    expect(box.textContent).toContain("add favourites in About Me");
    await typeInto(find<HTMLInputElement>("#library-user"), "1bad");
    await act(async () => {
      const select = find<HTMLSelectElement>("select");
      select.value = "lastfm";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit(find("form"));
    expect(box.textContent).toContain("That isn’t a Last.fm username.");
    await typeInto(find<HTMLInputElement>("#library-user"), "rob");
    await submit(find("form"));
    await settle();
    expect(connectedIn(localStorage.getItem(SERVICES_KEY))).toEqual([{ service: "lastfm", user: "rob" }]);
    expect(box.textContent).toContain("No listening there yet.");
  });

  it("stops at the most services allowed", async () => {
    connect(...Array.from({ length: 6 }, (_, i): [string, string] => ["deezer", String(i)]));
    handlers["/api/discover/listening"] = never;
    await render(<Library />);
    await typeInto(find<HTMLInputElement>("#library-user"), "rob");
    await submit(find("form"));
    expect(box.textContent).toContain("You can connect up to 6.");
  });

  it("lists what each service says is played most, matched to the catalog, and can disconnect", async () => {
    connect(["listenbrainz", "rob"], ["deezer", "12"]);
    handlers["/api/discover/listening"] = (url) =>
      url.searchParams.get("service") === "deezer"
        ? 404
        : { artists: [{ name: "Adele", plays: 40, artist: ADELE }, { name: "Drake", plays: null, artist: DRAKE }, { name: "Gone", plays: 2, artist: null }, { name: "Lost", plays: null, artist: null }] };
    handlers["/api/discover/nexus"] = () => ({
      artists: [ADELE, DRAKE],
      linked: [{ a: ADELE, b: DRAKE, reason: reason("Adele and Drake sang") }],
      between: [{ artist: HUB, with: [ADELE, DRAKE] }],
    });
    await render(<Library />);
    await settle();
    await settle();
    expect(box.textContent).toContain("2 artists of 4 in this catalog.");
    expect(box.textContent).toContain("40 plays");
    expect(box.textContent).toContain("note 2");
    expect(box.textContent).toContain("2 plays · not in this catalog");
    expect(box.textContent).toContain("Not in this catalog");
    expect(box.textContent).toContain("Refused (404)");
    expect(box.textContent).toContain("Adele and Drake sang");
    expect(box.textContent).toContain("Worked with Adele, Drake");
    const nexusCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("nexus"))!;
    expect(new URL(String(nexusCall[0]), "http://x").searchParams.get("artists")).toBe(`${ADELE.id},${DRAKE.id}`);
    await click(all("button").find((b) => b.textContent!.includes("Disconnect"))!);
    expect(connectedIn(localStorage.getItem(SERVICES_KEY))).toEqual([{ service: "deezer", user: "12" }]);
  });

  it("says when the artists share nothing, and when Your Nexus fails", async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ artists: [{ id: ADELE.id }, { id: DRAKE.id }], songs: [], albums: [], genres: [] }));
    handlers["/api/discover/nexus"] = () => ({ artists: [ADELE, DRAKE], linked: [], between: [] });
    await render(<Library />);
    await settle();
    expect(box.textContent).toContain("None of them share a credit in this catalog.");
    expect(box.textContent).toContain("No one in this catalog worked with more than one of them.");
    await unmount();
    mount();
    handlers["/api/discover/nexus"] = () => 500;
    await render(<Library />);
    await settle();
    expect(box.textContent).toContain("Your Nexus didn’t load.");
  });

  it("stops asking when it leaves", async () => {
    connect(["listenbrainz", "rob"]);
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ artists: [{ id: ADELE.id }, { id: DRAKE.id }], songs: [], albums: [], genres: [] }));
    handlers["/api/discover/listening"] = never;
    await render(<Library />);
    expect(box.querySelectorAll("[role=status]").length).toBeGreaterThan(1);
    await unmount();
    mount();
    handlers["/api/discover/nexus"] = never;
    localStorage.removeItem(SERVICES_KEY);
    await render(<Library />);
    await unmount();
    mount();
  });
});

describe("Friend paths", () => {
  const favourites = () =>
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ artists: [{ id: ADELE.id }, { id: DRAKE.id }], songs: [], albums: [], genres: [] }));

  it("asks for your artists first", async () => {
    await render(<FriendPaths theirs={[]} friend="your friend" />);
    expect(box.textContent).toContain("First tell Song Nexus what you like");
  });

  it("waits for your listening", async () => {
    connect(["listenbrainz", "rob"]);
    handlers["/api/discover/listening"] = never;
    await render(<FriendPaths theirs={[]} friend="your friend" />);
    expect(box.querySelector("[role=status]")).not.toBeNull();
  });

  it("copies a link with your artists and the name you give", async () => {
    favourites();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render(<FriendPaths theirs={[]} friend="your friend" />);
    await typeInto(find<HTMLInputElement>("input"), "Sam");
    await click(control("Copy your link"));
    expect(writeText).toHaveBeenCalledWith(`http://localhost:3000${friendHref([ADELE.id, DRAKE.id], "Sam")}`);
    expect(box.textContent).toContain("Copied");
    writeText.mockRejectedValueOnce(new Error("denied"));
    await click(control("Copied"));
    expect(box.textContent).toContain("Couldn’t copy");
    expect(friendHref(["a"], " ")).toBe("/discover/friends?with=a");
  });

  it("shows what you share with a friend, the paths between you and who links you", async () => {
    favourites();
    handlers["/api/discover/nexus"] = (url) => {
      expect([url.searchParams.get("artists"), url.searchParams.get("theirs")]).toEqual([`${ADELE.id},${DRAKE.id}`, FRIEND.id]);
      return {
        shared: [DRAKE],
        paths: [{ artists: [ADELE, HUB, FRIEND], reasons: [reason("first step"), reason("second step")] }],
        between: [{ artist: HUB, with: [ADELE, FRIEND] }],
      };
    };
    await render(<FriendPaths theirs={[FRIEND]} friend="Sam" />);
    await settle();
    expect(box.textContent).toContain("Artists you both have");
    expect(box.textContent).toContain("From your artists to Sam’s");
    expect(box.textContent).toContain("2 steps");
    expect(box.textContent).toContain("second step");
    expect(box.textContent).toContain("People who link your artists and theirs");
  });

  it("says when there's no path, and when the paths fail", async () => {
    favourites();
    handlers["/api/discover/nexus"] = () => ({ shared: [], paths: [], between: [] });
    await render(<FriendPaths theirs={[FRIEND]} friend="Sam" />);
    await settle();
    expect(box.textContent).toContain("No path between your artists and theirs in this catalog.");
    expect(box.textContent).not.toContain("Artists you both have");
    await unmount();
    mount();
    handlers["/api/discover/nexus"] = () => 500;
    await render(<FriendPaths theirs={[FRIEND]} friend="Sam" />);
    await settle();
    expect(box.textContent).toContain("The paths didn’t load.");
    await unmount();
    mount();
    handlers["/api/discover/nexus"] = never;
    await render(<FriendPaths theirs={[FRIEND]} friend="Sam" />);
    expect(box.querySelector("[role=status]")).not.toBeNull();
  });
});
