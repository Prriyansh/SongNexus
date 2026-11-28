// @vitest-environment jsdom
// Accounts in a browser: keeping data in step, the You page, and hiding a suggestion.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/discover/you" }));

import AccountSync, { ACCOUNT_CHANGED, SYNC_DELAY_MS } from "../components/AccountSync";
import ForYouShelf from "../components/ForYouShelf";
import You, { GOOGLE_SCRIPT } from "../components/You";
import { syncedIn, topIn, TOP_KEY } from "../lib/account-data";
import { GAMES_KEY, resultsIn } from "../lib/game-info";
import { hiddenArtistsIn, HIDDEN_KEY, PROFILE_KEY, writeStored } from "../lib/stored";
import { all, box, click, control, find, mount, press, render, type, unmount } from "./dom";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const artist = (n: number) => ({ id: id(n), name: `Artist ${n}`, note: "", photo: null });
const ADA = { name: "Ada Lovelace", picture: "https://lh3.googleusercontent.com/a/p", domain: "wisc.edu" };

type Handler = (method: string, body: unknown, url: URL, signal?: AbortSignal | null) => unknown;
let handlers: Record<string, Handler> = {};
let calls: { path: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
  handlers = {};
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost:3000");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path: url.pathname, method, body });
      const reply = await handlers[url.pathname](method, body, url, init?.signal);
      if (typeof reply === "number") return { ok: false, status: reply, json: async () => ({ error: `Refused (${reply})` }) };
      return { ok: true, status: 200, json: async () => reply };
    }),
  );
  mount();
});
afterEach(async () => {
  await unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.google;
  document.head.querySelectorAll("script").forEach((s) => s.remove());
});

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const saves = () => calls.filter((c) => c.path === "/api/discover/account/data");

describe("keeping data in step", () => {
  it("does nothing for someone signed out", async () => {
    handlers["/api/discover/account"] = () => ({ enabled: true, person: null, synced: null });
    await render(<AccountSync />);
    await flush();
    await act(async () => writeStored(TOP_KEY, [artist(1)]));
    await act(() => vi.advanceTimersByTimeAsync(SYNC_DELAY_MS));
    expect(saves()).toEqual([]);
  });

  it("merges the account's data in on arrival, saves the merge, then saves later changes once", async () => {
    localStorage.setItem(TOP_KEY, JSON.stringify([artist(1)]));
    handlers["/api/discover/account"] = () => ({ enabled: true, person: ADA, synced: syncedIn({ hidden: [artist(2)] }) });
    handlers["/api/discover/account/data"] = (_m, body) => ({ synced: body });
    await render(<AccountSync />);
    await flush();
    expect(hiddenArtistsIn(localStorage.getItem(HIDDEN_KEY))).toEqual([artist(2)]);
    expect(saves()).toHaveLength(1);
    expect((saves()[0].body as { top: unknown }).top).toEqual([artist(1)]);
    await act(async () => {
      writeStored(TOP_KEY, [artist(3)]);
      writeStored(TOP_KEY, [artist(3), artist(4)]);
    });
    await act(() => vi.advanceTimersByTimeAsync(SYNC_DELAY_MS));
    expect(saves()).toHaveLength(2);
    await act(async () => writeStored(TOP_KEY, [artist(3), artist(4)]));
    await act(() => vi.advanceTimersByTimeAsync(SYNC_DELAY_MS));
    expect(saves()).toHaveLength(2);
  });

  it("saves this browser's data to a new account, tries again after a failed save, and checks again on sign-in", async () => {
    let person: typeof ADA | null = null;
    handlers["/api/discover/account"] = () => ({ enabled: true, person, synced: null });
    let fail = true;
    handlers["/api/discover/account/data"] = () => (fail ? 500 : { synced: {} });
    await render(<AccountSync />);
    await flush();
    person = ADA;
    await act(async () => void window.dispatchEvent(new Event(ACCOUNT_CHANGED)));
    await flush();
    expect(saves()).toHaveLength(1);
    fail = false;
    await act(async () => writeStored(TOP_KEY, []));
    await act(() => vi.advanceTimersByTimeAsync(SYNC_DELAY_MS));
    expect(saves()).toHaveLength(2);
  });

  it("ignores an account that can't be read, and stops when it leaves", async () => {
    handlers["/api/discover/account"] = () => 500;
    await render(<AccountSync />);
    await flush();
    await unmount();
    mount();
    expect(saves()).toEqual([]);
  });
});

describe("the You page", () => {
  const google = () => {
    const id = { initialize: vi.fn(), renderButton: vi.fn(), disableAutoSelect: vi.fn() };
    window.google = { accounts: { id } };
    return id;
  };

  it("shows it is checking who is signed in", async () => {
    handlers["/api/discover/account"] = (_m, _b, _u, signal) =>
      new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    await render(<You clientId="client-1" />);
    expect(box.textContent).toContain("Checking…");
    await unmount();
    mount();
    expect(box.textContent).toBe("");
  });

  it("says sign-in isn't set up, and keeps everything in the browser", async () => {
    await render(<You clientId={null} />);
    expect(box.textContent).toContain("Sign-in isn’t set up on this server");
  });

  it("offers Google's button, and signs in with what it gives", async () => {
    const id = google();
    localStorage.setItem(TOP_KEY, JSON.stringify([artist(1)]));
    handlers["/api/discover/account"] = () => ({ enabled: true, person: null, synced: null });
    handlers["/api/discover/account/session"] = (method) => (method === "POST" ? { person: ADA, synced: syncedIn({ hidden: [artist(2)] }) } : { signedOut: true });
    handlers["/api/discover/account/data"] = (_m, body) => ({ synced: body });
    const told = vi.fn();
    window.addEventListener(ACCOUNT_CHANGED, told);
    await render(<You clientId="client-1" />);
    await flush();
    expect(id.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: "client-1" }));
    expect(id.renderButton).toHaveBeenCalledWith(find(".dx-google"), expect.objectContaining({ text: "signin_with" }));
    const { callback } = id.initialize.mock.calls[0][0] as { callback: (r: { credential: string }) => void };
    await act(async () => callback({ credential: "token" }));
    await flush();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ credential: "token" });
    expect(box.textContent).toContain("Ada Lovelace");
    expect(box.textContent).toContain("Signed in with Google · wisc.edu");
    expect(hiddenArtistsIn(localStorage.getItem(HIDDEN_KEY))).toEqual([artist(2)]);
    expect((saves()[0].body as { top: unknown }).top).toEqual([artist(1)]);
    expect(told).toHaveBeenCalled();
    await click(control("Sign out"));
    await flush();
    expect(id.disableAutoSelect).toHaveBeenCalled();
    expect(box.querySelector(".dx-google")).not.toBeNull();
    window.removeEventListener(ACCOUNT_CHANGED, told);
  });

  it("says when a sign-in is refused, or the account can't be read", async () => {
    const id = google();
    handlers["/api/discover/account"] = () => ({ enabled: true, person: null, synced: null });
    handlers["/api/discover/account/session"] = () => 401;
    await render(<You clientId="client-1" />);
    await flush();
    const { callback } = id.initialize.mock.calls[0][0] as { callback: (r: { credential: string }) => void };
    await act(async () => callback({ credential: "bad" }));
    await flush();
    expect(box.textContent).toContain("Refused (401)");
    await unmount();
    mount();
    handlers["/api/discover/account"] = () => 500;
    await render(<You clientId="client-1" />);
    await flush();
    expect(box.textContent).toContain("Your account didn’t load.");
  });

  it("loads Google's script when it isn't there yet, and says when it fails", async () => {
    handlers["/api/discover/account"] = () => ({ enabled: true, person: null, synced: null });
    await render(<You clientId="client-1" />);
    await flush();
    const script = document.head.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT}"]`)!;
    const id = google();
    await act(async () => void script.onload!(new Event("load")));
    expect(id.renderButton).toHaveBeenCalled();
    await act(async () => void script.onerror!(new Event("error")));
    expect(box.textContent).toContain("Google’s sign-in didn’t load.");
  });

  it("deletes the account after asking, and says when that fails", async () => {
    google();
    handlers["/api/discover/account"] = (method) => (method === "DELETE" ? 500 : { enabled: true, person: { ...ADA, picture: null, domain: null }, synced: null });
    await render(<You clientId="client-1" />);
    await flush();
    expect(box.textContent).toContain("Signed in with Google");
    expect(box.querySelector(".dx-you img")).toBeNull();
    await click(control("Delete account"));
    await click(all("button").find((b) => b.textContent === "Delete my account and everything synced")!);
    await flush();
    expect(box.textContent).toContain("Refused (500)");
    handlers["/api/discover/account"] = (method) => (method === "DELETE" ? { deleted: true } : { enabled: true, person: ADA, synced: null });
    await click(all("button").find((b) => b.textContent === "Delete my account and everything synced")!);
    await flush();
    expect(box.querySelector(".dx-google")).not.toBeNull();
  });

  it("keeps a Top 5", async () => {
    handlers["/api/discover/search"] = (_m, _b, url) => ({
      results: [{ kind: "artist", id: id(Number(url.searchParams.get("q"))), name: `Artist ${url.searchParams.get("q")}`, note: "", image: null }],
    });
    await render(<You clientId={null} />);
    for (const n of [1, 2, 1]) {
      await type(String(n));
      await press(find("input[role=combobox]"), "Enter");
    }
    expect(topIn(localStorage.getItem(TOP_KEY)).map((v) => v.name)).toEqual(["Artist 2", "Artist 1"]);
    for (const n of [3, 4, 5]) {
      await type(String(n));
      await press(find("input[role=combobox]"), "Enter");
    }
    expect(box.textContent).toContain("That’s five.");
    await click(control("Take Artist 2 out"));
    expect(topIn(localStorage.getItem(TOP_KEY))).toHaveLength(4);
  });

  it("lists hidden artists and suggests them again", async () => {
    await render(<You clientId={null} />);
    expect(box.textContent).toContain("None. Hide an artist");
    await act(async () => writeStored(HIDDEN_KEY, [artist(7)]));
    expect(box.textContent).toContain("Artist 7");
    await click(control("Suggest again"));
    expect(hiddenArtistsIn(localStorage.getItem(HIDDEN_KEY))).toEqual([]);
  });

  it("downloads this browser's data, and deletes it after asking, signing out first", async () => {
    localStorage.setItem(GAMES_KEY, JSON.stringify({ connect: { "1": { score: 2 } } }));
    localStorage.setItem("someone-else", "1");
    const made: string[] = [];
    vi.stubGlobal(
      "Blob",
      class {
        constructor(parts: string[]) {
          made.push(parts.join(""));
        }
      },
    );
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    google();
    handlers["/api/discover/account"] = () => ({ enabled: true, person: null, synced: null });
    handlers["/api/discover/account/session"] = () => 500;
    await render(<You clientId="client-1" />);
    await flush();
    await click(control("Download it"));
    expect(clicked).toHaveBeenCalled();
    expect(JSON.parse(made[0])).toEqual({ [GAMES_KEY]: { connect: { "1": { score: 2 } } } });
    await click(control("Delete it from this browser"));
    await click(all("button").find((b) => b.textContent === "Yes, delete everything in this browser and sign out here")!);
    await flush();
    expect(calls.some((c) => c.path === "/api/discover/account/session" && c.method === "DELETE")).toBe(true);
    expect(localStorage.getItem(GAMES_KEY)).toBeNull();
    expect(localStorage.getItem("someone-else")).toBe("1");
  });

  it("deletes this browser's data without signing out when there are no accounts", async () => {
    localStorage.setItem(PROFILE_KEY, "{}");
    await render(<You clientId={null} />);
    await click(control("Delete it from this browser"));
    await click(all("button").find((b) => b.textContent === "Yes, delete everything in this browser")!);
    await flush();
    expect(localStorage.getItem(PROFILE_KEY)).toBeNull();
    expect(calls).toEqual([]);
    expect(resultsIn(null).connect).toEqual({});
  });
});

describe("hiding a suggestion", () => {
  it("leaves the artist out from then on", async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ artists: [{ id: id(1) }], songs: [], albums: [], genres: [] }));
    localStorage.setItem(TOP_KEY, JSON.stringify([artist(2)]));
    handlers["/api/discover/for-you"] = () => ({
      picks: [{ artist: { ...artist(10), listeners: null }, because: { ...artist(1), listeners: null }, reason: null, genre: null }],
      known: { artists: 2, genres: 0 },
    });
    await render(<ForYouShelf />);
    await flush();
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0]), "http://x").searchParams.get("artists")).toBe(`${id(2)},${id(1)}`);
    await click(control("Don’t suggest Artist 10"));
    await flush();
    expect(hiddenArtistsIn(localStorage.getItem(HIDDEN_KEY)).map((v) => v.id)).toEqual([id(10)]);
    expect(String(vi.mocked(fetch).mock.lastCall![0])).toContain(`hidden=${id(10)}`);
  });
});
