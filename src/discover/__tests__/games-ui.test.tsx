// @vitest-environment jsdom
// Playing the games in a browser: Connect, the quizzes, the leaderboard and the progress shown.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/discover/games" }));

import ConnectGame from "../components/ConnectGame";
import { GameBadge, GameStats } from "../components/GameProgress";
import Leaderboard from "../components/Leaderboard";
import QuizGame from "../components/QuizGame";
import { LAUNCH_DAY } from "../lib/days";
import { GAMES_KEY, MAX_CHAIN, PLAYER_KEY, resultsIn, type QuizQuestion } from "../lib/game-info";
import type { ArtistRef } from "../lib/types";
import { all, box, click, control, find, mount, press, render, settle, type, unmount } from "./dom";

const DAY = LAUNCH_DAY;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (n: number, name: string): ArtistRef => ({ id: id(n), name, note: "", listeners: null, photo: null });
const [START, MID, END, OTHER] = [person(1, "Start"), person(2, "Middle"), person(3, "End"), person(4, "Other")];
const reason = (text: string) => ({ category: "features" as const, text, subject: null, year: 2000 });

type Handler = (body: Record<string, unknown> | null, url: URL, signal?: AbortSignal | null) => unknown;
let handlers: Record<string, Handler> = {};
const never: Handler = (_b, _u, signal) =>
  new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
  handlers = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://x");
      const reply = await handlers[url.pathname](init?.body ? JSON.parse(String(init.body)) : null, url, init?.signal);
      if (typeof reply === "number")
        return { ok: false, status: reply, json: async () => (reply === 418 ? Promise.reject(new Error("no body")) : { error: `Refused (${reply})` }) };
      return { ok: true, status: 200, json: async () => reply };
    }),
  );
  mount();
});
afterEach(async () => {
  await unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const stored = () => resultsIn(localStorage.getItem(GAMES_KEY));
/** A quiz choice by the name under its portrait. */
const option = (name: string) => all("button.dx-option").find((b) => b.textContent!.endsWith(name))!;
const store = (results: unknown) => localStorage.setItem(GAMES_KEY, JSON.stringify(results));

describe("Connect", () => {
  const puzzle = { start: START, target: END, par: 2 };
  /** Search finds whoever is typed; a step links everyone but Other, and reaches End. */
  const play = () => {
    handlers["/api/discover/search"] = (_b, url) => ({
      results: [MID, END, OTHER].filter((a) => a.name === url.searchParams.get("q")).map((a) => ({ kind: "artist", id: a.id, name: a.name, note: "", image: null })),
    });
    handlers["/api/discover/games/step"] = (body) =>
      body!.guess === OTHER.id ? { linked: false, reason: null, reached: false } : { linked: true, reason: reason(`linked to ${body!.guess}`), reached: body!.guess === END.id };
  };
  const pick = async (name: string) => {
    await type(name);
    await press(find("input"), "Enter");
    await settle();
  };

  it("takes steps through real links, counts misses, and finishes at the target", async () => {
    play();
    await render(<ConnectGame day={DAY} puzzle={puzzle} />);
    expect(box.textContent).toContain("par 2 steps");
    await pick("Other");
    expect(box.textContent).toContain("No credit links Start and Other in this catalog.");
    expect(box.textContent).toContain("Misses so far: 1.");
    await pick("Middle");
    expect(box.textContent).toContain(`linked to ${MID.id}`);
    expect(find("label").textContent).toBe("Who did Middle work with?");
    await pick("End");
    expect(box.textContent).toContain("You connected them in 2 steps, as few as possible.");
    expect(stored().connect[DAY]).toEqual({ score: 2, gaveUp: false, submitted: false, answers: [START.id, MID.id, END.id] });
    expect(control("Copy my result")).toBeTruthy();
    expect(all("a").some((a) => a.getAttribute("href")!.startsWith("/discover/six-degrees?from="))).toBe(true);
  });

  it("says when it took more steps than needed, and can undo a step", async () => {
    play();
    await render(<ConnectGame day={DAY} puzzle={{ ...puzzle, par: 1 }} />);
    expect(box.textContent).toContain("par 1 step");
    await pick("Middle");
    await click(control("Undo the last step"));
    expect(box.textContent).not.toContain(`linked to ${MID.id}`);
    await pick("Middle");
    await pick("End");
    expect(box.textContent).toContain("You connected them in 2 steps; it can be done in 1.");
  });

  it("can show the answer instead", async () => {
    await render(<ConnectGame day={DAY} puzzle={puzzle} />);
    await click(control("Show me the answer"));
    expect(box.textContent).toContain("You stopped here. The shortest way takes 2 steps.");
    expect(stored().connect[DAY].gaveUp).toBe(true);
    expect(() => control("Copy my result")).toThrow();
  });

  it("stops at the longest chain allowed", async () => {
    play();
    await render(<ConnectGame day={DAY} puzzle={puzzle} />);
    for (let i = 0; i < MAX_CHAIN; i++) await pick("Middle");
    expect(box.textContent).toContain("That’s as long as a chain can be.");
    expect(box.querySelector("input")).toBeNull();
  });

  it("says when a step didn't go through, and ignores picks while one is checked", async () => {
    play();
    let release: (value: unknown) => void = () => {};
    handlers["/api/discover/games/step"] = () => new Promise((resolve) => (release = resolve));
    await render(<ConnectGame day={DAY} puzzle={puzzle} />);
    await pick("Middle");
    await pick("End");
    await act(async () => release(500));
    await settle();
    expect(box.textContent).toContain("That didn’t go through. Try again.");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("step"))).toHaveLength(1);
  });

  it("shows a finished day as finished", async () => {
    store({ connect: { [DAY]: { score: 2, answers: [] } } });
    await render(<ConnectGame day={DAY} puzzle={puzzle} />);
    expect(box.textContent).toContain("You connected them in 2 steps");
  });
});

describe("a quiz", () => {
  const questions: QuizQuestion[] = [
    { text: "Who produced it?", song: { kind: "song", id: id(50), name: "A Song", note: "Start" }, options: [MID, OTHER] },
    { text: "Who connects them?", song: null, options: [MID, OTHER] },
    { text: "And them?", song: null, options: [MID, OTHER] },
  ];
  beforeEach(() => {
    handlers["/api/discover/games/answer"] = (body) => ({
      correct: body!.choice === MID.id,
      answer: MID,
      proof: [reason(`proof ${body!.question}`)],
    });
  });

  it("asks one question at a time, shows each answer with its proof, then the score", async () => {
    await render(<QuizGame game="link" day={DAY} questions={questions} />);
    expect(box.textContent).toContain("Question 1 of 3");
    expect(box.textContent).toContain("A Song");
    await click(option("Middle"));
    await settle();
    expect(box.textContent).toContain("Right.");
    expect(box.textContent).toContain("proof 0");
    expect(find("[data-state=right]").textContent).toContain("Middle");
    await click(control("Next question"));
    await click(option("Other"));
    await settle();
    expect(box.textContent).toContain("It’s Middle.");
    expect(find("[data-state=wrong]").textContent).toContain("Other");
    await click(control("Next question"));
    await click(option("Middle"));
    await settle();
    await click(control("See my score"));
    expect(stored().link[DAY]).toEqual({ score: 1, gaveUp: false, submitted: false, answers: [MID.id, OTHER.id, MID.id] });
    expect(box.textContent).toContain("You got 2 of 3 right.");
  });

  it("says when an answer didn't go through", async () => {
    handlers["/api/discover/games/answer"] = () => 500;
    await render(<QuizGame game="credits" day={DAY} questions={questions} />);
    await click(option("Middle"));
    await settle();
    expect(box.textContent).toContain("That didn’t go through. Pick again.");
  });
});

describe("the leaderboard", () => {
  const entries = { entries: [{ name: "Ada", score: 2 }, { name: "Me", score: 3 }], total: 4, mine: 1 };

  it("shows the day's best and your place", async () => {
    handlers["/api/discover/games/board"] = () => entries;
    await render(<Leaderboard game="connect" day={DAY} />);
    await settle();
    expect(all(".dx-board-list li").map((li) => li.textContent)).toEqual(["Ada2 steps", "Me3 steps"]);
    expect(find("[aria-current]").textContent).toContain("Me");
    expect(box.textContent).toContain("You’re 2 of 4.");
    expect(box.querySelector("form")).toBeNull();
  });

  it("says when no one is on it, or it can't be read", async () => {
    handlers["/api/discover/games/board"] = () => ({ entries: [], total: 0, mine: null });
    await render(<Leaderboard game="credits" day={DAY} />);
    await settle();
    expect(box.textContent).toContain("No one is on it yet.");
    await unmount();
    mount();
    handlers["/api/discover/games/board"] = () => 503;
    await render(<Leaderboard game="credits" day={DAY} />);
    await settle();
    expect(box.textContent).toContain("The leaderboard isn’t available right now.");
  });

  it("puts a finished game on the board under a chosen name", async () => {
    store({ link: { [DAY]: { score: 0, answers: [MID.id, MID.id, MID.id] } } });
    let sent: Record<string, unknown> | null = null;
    handlers["/api/discover/games/board"] = () => (sent ? entries : { entries: [], total: 0, mine: null });
    handlers["/api/discover/games/score"] = (body) => {
      sent = body;
      return { score: 0, added: true, place: 0, total: 1 };
    };
    await render(<Leaderboard game="link" day={DAY} />);
    await settle();
    const input = find<HTMLInputElement>("form input");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      set.call(input, "Ada");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => void find("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    expect(sent).toMatchObject({ game: "link", day: DAY, name: "Ada", answers: [MID.id, MID.id, MID.id] });
    expect(JSON.parse(localStorage.getItem(PLAYER_KEY)!)).toBe((sent as unknown as { player: string }).player);
    expect(stored().link[DAY].submitted).toBe(true);
    expect(box.querySelector("form")).toBeNull();
    expect(box.textContent).toContain("You’re 2 of 4.");
  });

  it("keeps this browser's player, and says when a score was refused", async () => {
    store({ credits: { [DAY]: { score: 1, answers: ["a"] } } });
    localStorage.setItem(PLAYER_KEY, JSON.stringify(id(77)));
    let player: unknown = null;
    handlers["/api/discover/games/board"] = (_b, url) => {
      player = url.searchParams.get("player");
      return { entries: [], total: 0, mine: null };
    };
    handlers["/api/discover/games/score"] = () => 418;
    await render(<Leaderboard game="credits" day={DAY} />);
    await settle();
    expect(player).toBe(id(77));
    await act(async () => void find("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    expect(box.textContent).toContain("Discover games/score failed (418)");
    expect(find<HTMLButtonElement>("form button").disabled).toBe(false);
  });

  it("offers nothing for a game left unfinished, and stops asking when it leaves", async () => {
    store({ connect: { [DAY]: { score: 9, gaveUp: true, answers: [] } } });
    handlers["/api/discover/games/board"] = never;
    await render(<Leaderboard game="connect" day={DAY} />);
    expect(box.querySelector("form")).toBeNull();
    await unmount();
    mount();
  });
});

describe("progress", () => {
  it("shows each game's state on a day", async () => {
    store({ connect: { [DAY]: { score: 3 }, [DAY - 1]: { score: 9, gaveUp: true } }, credits: { [DAY]: { score: 1 } } });
    await render(
      <>
        <GameBadge game="connect" day={DAY} />|<GameBadge game="connect" day={DAY - 1} />|<GameBadge game="credits" day={DAY} />|
        <GameBadge game="link" day={DAY} />
      </>,
    );
    expect(box.textContent).toBe("Done · 3 steps|Stopped|Done · 4 of 5|To play");
  });

  it("counts the streak and totals, in words that fit the numbers", async () => {
    await render(<GameStats today={DAY} />);
    expect(box.textContent).toBe("0 days in a row0 days played0 Connects solved0 perfect quizzes");
    await act(async () => {
      store({ connect: { [DAY]: { score: 3 } }, link: { [DAY]: { score: 0 } } });
      window.dispatchEvent(new Event("storage"));
    });
    expect(box.textContent).toBe("1 day in a row1 day played1 Connect solved1 perfect quiz");
  });
});
