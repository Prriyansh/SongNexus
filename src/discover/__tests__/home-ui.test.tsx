// @vitest-environment jsdom
// The home page's personal parts: what the browser keeps, For you, where you left off, today.
import { act } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/discover" }));

import ForYouShelf from "../components/ForYouShelf";
import RecentShelf from "../components/RecentShelf";
import RememberVisit from "../components/RememberVisit";
import TodayCard from "../components/TodayCard";
import {
  favouritesIn,
  HIDDEN_KEY,
  hiddenIn,
  MAX_RECENT,
  PROFILE_KEY,
  readStored,
  RECENT_KEY,
  recentIn,
  subscribeStored,
  withVisit,
  writeStored,
} from "../lib/stored";
import type { ForYouPick } from "../lib/types";
import { box, click, control, mount, render, unmount } from "./dom";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const artist = (n: number, name: string) => ({ id: id(n), name, note: "", listeners: null, photo: null });
const PHOTO = "https://upload.wikimedia.org/wikipedia/commons/a.jpg";

/** A fetch answering each call with the next of `replies` (an object, an error status, or never). */
function answering(...replies: (unknown | number | "never")[]) {
  const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    if (reply === "never")
      return new Promise((_, reject) =>
        init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
      );
    if (typeof reply === "number") return Promise.resolve({ ok: false, status: reply, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => reply });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const settle = () => act(async () => {});

beforeEach(() => {
  localStorage.clear();
  mount();
});
afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("what the browser keeps", () => {
  it("reads About Me's favourites, whatever shape they're stored in", () => {
    const profile = {
      artists: [{ id: id(1).toUpperCase() }, { id: "nope" }, null],
      songs: [{ artistId: id(2) }, { artistId: null }],
      albums: [{ artistId: id(1) }],
      genres: [" pop ", "pop", "", 7, "jazz"],
    };
    expect(favouritesIn(JSON.stringify(profile))).toEqual({ artists: [id(1), id(2)], genres: ["pop", "jazz"] });
    for (const raw of [null, "", "{not json", "42", '{"artists":"x"}'])
      expect(favouritesIn(raw)).toEqual({ artists: [], genres: [] });
  });

  it("keeps the artists opened lately, the latest first, each once", () => {
    const stored = JSON.stringify([
      { id: id(1), name: "One", note: "n", photo: PHOTO },
      { id: id(2), name: "Two", photo: "https://elsewhere.example/x.jpg" },
      { id: "bad", name: "Bad" },
      { id: id(3), name: "" },
    ]);
    expect(recentIn(stored)).toEqual([
      { id: id(1), name: "One", note: "n", photo: PHOTO },
      { id: id(2), name: "Two", note: "", photo: null },
    ]);
    expect(recentIn("{}")).toEqual([]);
    const visit = { id: id(2), name: "Two", note: "", photo: null };
    expect(withVisit(stored, visit).map((v) => v.id)).toEqual([id(2), id(1)]);
    const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: id(100 + i), name: `A${i}` })));
    expect(withVisit(many, visit)).toHaveLength(MAX_RECENT);
  });

  it("reads hidden artists", () => {
    const one = { id: id(1), name: "One" };
    expect(hiddenIn(JSON.stringify([one, one, id(2), { id: "x", name: "X" }, 3]))).toEqual([id(1)]);
  });

  it("writes, removes and tells this tab, and survives storage that refuses", () => {
    const heard = vi.fn();
    const stop = subscribeStored(heard);
    writeStored(RECENT_KEY, [1]);
    expect(readStored(RECENT_KEY)).toBe("[1]");
    writeStored(RECENT_KEY, null);
    expect(readStored(RECENT_KEY)).toBeNull();
    window.dispatchEvent(new Event("storage"));
    expect(heard).toHaveBeenCalledTimes(3);
    stop();
    writeStored(RECENT_KEY, [2]);
    expect(heard).toHaveBeenCalledTimes(3);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeStored(RECENT_KEY, [3])).not.toThrow();
    expect(readStored(RECENT_KEY)).toBeNull();
  });
});

describe("for you", () => {
  const picks: ForYouPick[] = [
    { artist: artist(10, "Close One"), because: artist(1, "Fave"), reason: { category: "features", text: "They sang", subject: null, year: null }, genre: null },
    { artist: artist(11, "Genre One"), because: null, reason: null, genre: { kind: "genre", id: "pop", name: "pop", note: "Genre" } },
  ];
  const favour = () =>
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ artists: [{ id: id(1) }], songs: [], albums: [], genres: ["pop"] }));

  it("sends readers to About Me before there are favourites, also on the server", async () => {
    expect(renderToString(<ForYouShelf />)).toContain('href="/about"');
    await render(<ForYouShelf />);
    expect(box.textContent).toContain("Add the artists, songs and genres you love in About Me");
  });

  it("suggests artists for the favourites, saying why, without hidden artists", async () => {
    favour();
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([{ id: id(9), name: "Hidden" }]));
    const fetchMock = answering({ picks, known: { artists: 1, genres: 1 } });
    await render(<ForYouShelf />);
    await settle();
    expect(box.textContent).toContain("Because you like Fave");
    expect(box.textContent).toContain("Known for pop");
    const url = new URL(fetchMock.mock.calls[0][0], "http://x");
    expect(url.pathname).toBe("/api/discover/for-you");
    expect([url.searchParams.get("artists"), url.searchParams.getAll("genre"), url.searchParams.get("hidden")]).toEqual([id(1), ["pop"], id(9)]);
  });

  it("asks again when the favourites change", async () => {
    favour();
    const fetchMock = answering({ picks: [], known: { artists: 0, genres: 0 } });
    await render(<ForYouShelf />);
    await settle();
    expect(box.textContent).toContain("None of your favourites are in this catalog yet");
    await act(async () => writeStored(PROFILE_KEY, { artists: [{ id: id(2) }], songs: [], albums: [], genres: [] }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).not.toContain("hidden=");
  });

  it("offers to try again when suggestions fail", async () => {
    favour();
    answering(500, { picks, known: { artists: 1, genres: 1 } });
    await render(<ForYouShelf />);
    await settle();
    expect(box.textContent).toContain("Suggestions didn’t load.");
    await click(control("Try again"));
    await settle();
    expect(box.textContent).toContain("Because you like Fave");
  });

  it("stops asking when it leaves", async () => {
    favour();
    const fetchMock = answering("never");
    await render(<ForYouShelf />);
    expect(box.querySelector("[role=status]")).not.toBeNull();
    await unmount();
    mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("where you left off", () => {
  it("shows nothing until an artist page is opened, then that artist", async () => {
    await render(<RecentShelf title="Where you left off" />);
    expect(box.textContent).toBe("");
    await render(
      <>
        <RememberVisit visit={{ id: id(5), name: "Visited", note: "a note", photo: PHOTO }} />
        <RecentShelf title="Where you left off" />
      </>,
    );
    expect(box.textContent).toContain("Visited");
    expect(recentIn(localStorage.getItem(RECENT_KEY))[0].name).toBe("Visited");
  });
});

describe("today's story", () => {
  const story = { n: 4, title: "Two steps apart", text: "A and B both worked with C.", artists: [artist(1, "A"), artist(2, "B"), artist(3, "C"), artist(4, "D")] };

  it("shows today's story, linked to it", async () => {
    answering({ day: 1, story });
    await render(<TodayCard />);
    await settle();
    expect(box.textContent).toContain("Today’s story · Two steps apart");
    expect(box.querySelector("a")!.getAttribute("href")).toBe("/discover/stories?story=4");
    expect(box.querySelectorAll(".dx-avatar")).toHaveLength(3);
  });

  it("links to Stories when there is no story or it didn't load", async () => {
    answering({ day: 1, story: null });
    await render(<TodayCard />);
    await settle();
    expect(box.querySelector("a")!.getAttribute("href")).toBe("/discover/stories");
    await unmount();
    mount();
    answering(500);
    await render(<TodayCard />);
    await settle();
    expect(box.textContent).toContain("Connections found in the credits");
  });

  it("stops asking when it leaves", async () => {
    answering("never");
    await render(<TodayCard />);
    expect(box.querySelector("[role=status]")!.getAttribute("aria-label")).toBe("Loading today’s story");
    await unmount();
    mount();
  });
});
