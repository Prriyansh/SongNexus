// The Games pages, rendered whole: the hub, each game, other days, and days without a game.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const none = vi.hoisted(() => ({ puzzle: false, quiz: false }));
class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/discover/games",
}));
vi.mock("next/server", async (actual) => ({ ...(await actual<object>()), connection: async () => {} }));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  type Props = { href: string; prefetch?: boolean; scroll?: boolean; children?: unknown };
  return {
    default: ({ prefetch, scroll, ...props }: Props) => {
      void [prefetch, scroll];
      return createElement("a", props as never);
    },
  };
});
vi.mock("@/discover/lib/games", async (actual) => {
  const real = await actual<typeof import("@/discover/lib/games")>();
  return {
    ...real,
    puzzleOf: (...args: Parameters<typeof real.puzzleOf>) => (none.puzzle ? null : real.puzzleOf(...args)),
    quizOf: (...args: Parameters<typeof real.quizOf>) => (none.quiz ? [] : real.quizOf(...args)),
  };
});

import GamePage, { generateMetadata } from "@/app/discover/games/[game]/page";
import GamesPage from "@/app/discover/games/page";
import { DAY_MS, LAUNCH_DAY } from "../lib/days";
import { puzzleOf, quizOf } from "../lib/games";
import { graph } from "../lib/server";
import { hrefsOf, renderPage, textOf } from "./render";

const at = (day: number) => vi.setSystemTime(day * DAY_MS + 3_600_000);
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => {
  vi.useRealTimers();
  Object.assign(none, { puzzle: false, quiz: false });
});

const hub = async () => {
  const html = await renderPage(GamesPage());
  return { html, text: textOf(html), hrefs: hrefsOf(html) };
};
const game = async (name: string, day?: string) => {
  const html = await renderPage(
    GamePage({ params: Promise.resolve({ game: name }), searchParams: Promise.resolve(day ? { day } : {}) }),
  );
  return { text: textOf(html), hrefs: hrefsOf(html) };
};

describe("the Games hub", () => {
  it("lists today's three games, the start and end of today's Connect, and no archive on the first day", async () => {
    at(LAUNCH_DAY);
    const { html, text, hrefs } = await hub();
    for (const name of ["Connect", "Credit check", "The missing link"]) expect(text).toContain(name);
    expect(text).toContain("28 November 2026");
    const puzzle = puzzleOf(graph(), LAUNCH_DAY)!;
    expect(textOf(html.replace(/aria-label="([^"]*)"/g, ">$1<"))).toContain(`From ${puzzle.start.name} to ${puzzle.target.name}`);
    expect(hrefs).toEqual(expect.arrayContaining(["/discover/games/connect", "/discover/games/credits", "/discover/games/link"]));
    expect(text).not.toContain("Archive");
  });

  it("keeps every earlier day in the archive", async () => {
    at(LAUNCH_DAY + 2);
    const { text, hrefs } = await hub();
    expect(text).toContain("Archive");
    expect(hrefs).toContain("/discover/games/credits?day=2026-11-29");
    expect(hrefs).toContain("/discover/games/link?day=2026-11-28");
    expect(hrefs).not.toContain("/discover/games/link?day=2026-11-30");
  });

  it("leaves out today's faces when there is no puzzle", async () => {
    at(LAUNCH_DAY);
    none.puzzle = true;
    expect((await hub()).html).not.toContain('aria-label="From ');
  });
});

describe("a game's page", () => {
  it("plays today's Connect, with no day before the first", async () => {
    at(LAUNCH_DAY);
    const puzzle = puzzleOf(graph(), LAUNCH_DAY)!;
    const { text, hrefs } = await game("connect");
    expect(text).toContain(`Today, 28 November 2026`);
    expect(text).toContain(puzzle.start.name);
    expect(text).toContain(`par ${puzzle.par}`);
    expect(text).toContain("Leaderboard");
    expect(text).not.toContain("The day before");
    expect(hrefs).not.toContain("/discover/games/connect?day=2026-11-29");
  });

  it("opens an earlier day, with the days around it", async () => {
    at(LAUNCH_DAY + 2);
    const { text, hrefs } = await game("credits", "2026-11-29");
    expect(text).toContain(quizOf(graph(), "credits", LAUNCH_DAY + 1)[0].text);
    expect(text).toContain("Question 1 of 5");
    expect(hrefs).toContain("/discover/games/credits?day=2026-11-28");
    expect(hrefs).toContain("/discover/games/credits?day=2026-11-30");
  });

  it("says when a day has no game", async () => {
    at(LAUNCH_DAY);
    Object.assign(none, { puzzle: true, quiz: true });
    expect((await game("connect")).text).toContain("This catalog has no Connect puzzle for this day.");
    expect((await game("link")).text).toContain("This catalog has no questions for this day.");
  });

  it("is not found for a game that doesn't exist", async () => {
    await expect(game("chess")).rejects.toBeInstanceOf(NotFound);
  });

  it("is titled after its game", async () => {
    expect((await generateMetadata({ params: Promise.resolve({ game: "link" }), searchParams: Promise.resolve({}) })).title).toBe(
      "The missing link · Song Nexus",
    );
    expect((await generateMetadata({ params: Promise.resolve({ game: "chess" }), searchParams: Promise.resolve({}) })).title).toBe(
      "Games · Song Nexus",
    );
  });
});
