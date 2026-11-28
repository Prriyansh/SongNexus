// The daily games: making each day's, checking answers, the results a browser keeps, storage and
// leaderboards.
import { describe, expect, it, vi } from "vitest";
import { currentLink } from "../components/SidebarLinks";
import { dateOfDay, dayIn, dayNumber, LAUNCH_DAY, longDate, todayNumber } from "../lib/days";
import {
  gameHref,
  isGame,
  isPlayer,
  QUESTIONS,
  resultsIn,
  scoreText,
  statsOf,
  storedPlayer,
  streakOf,
  withResult,
} from "../lib/game-info";
import { chainSteps, checkAnswer, linkReason, MADE_KEPT, puzzleOf, quizMisses, quizOf, scoreOf } from "../lib/games";
import { cleanName, readBoard, submitScore } from "../lib/leaderboard";
import { findPath } from "../lib/paths";
import { graph } from "../lib/server";
import { memoryStore, redisStore, store } from "../lib/store";
import { DEFAULT_CATEGORIES } from "../lib/types";
import { world, type WorldSpec } from "./world";

const g = graph();
const DAY = LAUNCH_DAY;
describe("the sidebar", () => {
  it("marks Games on every game's page, and Discover on artist pages", () => {
    expect(currentLink("/discover/games/connect")!.label).toBe("Games");
    expect(currentLink("/discover/artist/x")!.label).toBe("Discover");
  });
});

describe("days", () => {
  it("numbers days in UTC and reads them from addresses", () => {
    expect(dateOfDay(LAUNCH_DAY)).toBe("2026-11-28");
    expect(longDate(LAUNCH_DAY)).toBe("28 November 2026");
    expect(dayIn("2026-11-29", LAUNCH_DAY + 5)).toBe(LAUNCH_DAY + 1);
    for (const bad of ["", "2026-11-27", "2027-01-01", "yesterday"]) expect(dayIn(bad, LAUNCH_DAY + 5)).toBe(LAUNCH_DAY + 5);
    expect(todayNumber()).toBe(dayNumber(Date.now()));
  });
});

describe("Connect", () => {
  it("picks two well-known artists three or four steps apart, the same all day", () => {
    const puzzle = puzzleOf(g, DAY)!;
    expect(puzzle.par).toBeGreaterThanOrEqual(3);
    expect(puzzle.par).toBeLessThanOrEqual(4);
    expect(puzzleOf(g, DAY)).toEqual(puzzle);
    expect(puzzleOf(g, DAY + 1)).not.toEqual(puzzle);
  });

  it("scores a chain of real links by its steps, and nothing else", () => {
    const puzzle = puzzleOf(g, DAY)!;
    const [start, target] = [g.catalog.artistAt.get(puzzle.start.id)!, g.catalog.artistAt.get(puzzle.target.id)!];
    const chain = findPath(g, start, target, { categories: DEFAULT_CATEGORIES })!.map((a) => g.catalog.artists[a].id);
    expect(chainSteps(g, puzzle, chain)).toBe(puzzle.par);
    expect(scoreOf(g, "connect", DAY, chain)).toBe(puzzle.par);
    expect(linkReason(g, start, g.catalog.artistAt.get(chain[1])!)).not.toBeNull();
    expect(chainSteps(g, puzzle, [chain[0]])).toBeNull();
    expect(chainSteps(g, puzzle, Array(10).fill(chain[0]))).toBeNull();
    expect(chainSteps(g, puzzle, [chain[0], "nobody", chain.at(-1)!])).toBeNull();
    expect(chainSteps(g, puzzle, chain.slice(1))).toBeNull();
    expect(chainSteps(g, puzzle, chain.slice(0, -1))).toBeNull();
    expect(chainSteps(g, puzzle, [chain[0], chain.at(-1)!])).toBeNull();
  });

  it("has no puzzle when no well-known pair is far enough apart, or connected at all", () => {
    const three: WorldSpec = {
      artists: ["A", "B"],
      others: ["X", "Y"],
      songs: [
        ["ax", 2000, [["A", "primary"], ["X", "featured"]]],
        ["xy", 2001, [["X", "primary"], ["Y", "featured"]]],
        ["yb", 2002, [["Y", "primary"], ["B", "featured"]]],
      ],
    };
    expect(puzzleOf(world(three), DAY)!.par).toBe(3);
    expect(puzzleOf(world({ ...three, songs: three.songs!.slice(0, 1) }), DAY)).toBeNull();
    const two = world({ artists: ["A", "B"], others: ["X"], songs: [["ax", 2000, [["A", "primary"], ["X", "featured"]]], ["bx", 2001, [["B", "primary"], ["X", "featured"]]]] });
    expect(puzzleOf(two, DAY)).toBeNull();
    expect(linkReason(two, 0, 1)).toBeNull();
    expect(scoreOf(two, "connect", DAY, [])).toBeNull();
  });
});

describe("Credit check", () => {
  it("asks five questions with four choices, one of them right, the answer kept here", () => {
    const questions = quizOf(g, "credits", DAY);
    expect(questions).toHaveLength(QUESTIONS.credits);
    expect(questions.map((q) => /^Who (?:is )?(\w+)/.exec(q.text)![1])).toEqual(["produced", "featured", "credited", "produced", "featured"]);
    const right: string[] = [];
    questions.forEach((question, i) => {
      expect(question.options).toHaveLength(4);
      expect(JSON.stringify(question)).not.toContain("answer");
      const checked = question.options.map((o) => checkAnswer(g, "credits", DAY, i, o.id)!);
      expect(checked.filter((c) => c.correct)).toHaveLength(1);
      right.push(checked.find((c) => c.correct)!.answer.id);
      expect(checked[0].proof[0].text).toContain(checked[0].answer.name);
    });
    expect(quizMisses(g, "credits", DAY, right)).toBe(0);
    expect(scoreOf(g, "credits", DAY, right.map((id, i) => (i < 2 ? "wrong" : id)))).toBe(2);
    expect(quizMisses(g, "credits", DAY, right.slice(1))).toBeNull();
    expect(checkAnswer(g, "credits", DAY, 9, right[0])).toBeNull();
  });

  it("skips songs without the credit asked about, or too few other people for wrong answers", () => {
    const spec: WorldSpec = {
      artists: ["A"],
      others: ["P1", "P2", "P3", "P4", "Quiet"],
      songs: [
        ["bare", 2000, [["A", "primary"]]],
        ["one", 2001, [["A", "primary"], ["P1", "producer"], ["Quiet", "instrument", ""]]],
        ["two", 2002, [["A", "primary"], ["P2", "producer"]]],
        ["three", 2003, [["A", "primary"], ["P3", "producer"]]],
      ],
      listeners: { P1: 10, P2: 10, P3: 10, P4: 10, Quiet: null },
    };
    expect(quizOf(world(spec), "credits", DAY)).toEqual([]);
    const enough = world({ ...spec, songs: [...spec.songs!, ["four", 2004, [["A", "primary"], ["P4", "producer"]]]] });
    const [question] = quizOf(enough, "credits", DAY);
    expect(question.text).toMatch(/^Who produced “(one|two|three|four)” by A\?$/);
    expect(quizOf(enough, "credits", DAY)).toHaveLength(1);
  });
});

describe("The missing link", () => {
  it("asks three questions with exactly one person who worked with both", () => {
    const questions = quizOf(g, "link", DAY);
    expect(questions).toHaveLength(QUESTIONS.link);
    questions.forEach((question, i) => {
      const checked = question.options.map((o) => checkAnswer(g, "link", DAY, i, o.id)!);
      expect(checked.filter((c) => c.correct)).toHaveLength(1);
      expect(checked[0].proof).toHaveLength(2);
    });
  });

  const pair = (songs: WorldSpec["songs"]) => world({ artists: ["A", "B"], others: ["C", "D", "E", "F", "G"], songs });
  const feat = (title: string, lead: string, guest: string): [string, number, [string, string][]] => [title, 2000, [[lead, "primary"], [guest, "featured"]]];

  it("skips pairs who worked together, with no one in common, or too few wrong answers", () => {
    expect(quizOf(pair([feat("ab", "A", "B"), feat("ac", "A", "C"), feat("bc", "B", "C")]), "link", DAY)).toEqual([]);
    expect(quizOf(pair([feat("ac", "A", "C"), feat("bd", "B", "D")]), "link", DAY)).toEqual([]);
    expect(quizOf(pair([feat("ac", "A", "C"), feat("bc", "B", "C"), feat("ad", "A", "D")]), "link", DAY)).toEqual([]);
  });

  it("takes the closest person in common, the first in the catalog on a tie", () => {
    const tie = pair([feat("ac", "A", "C"), feat("bc", "B", "C"), feat("ad", "A", "D"), feat("bd", "B", "D"), feat("ae", "A", "E"), feat("af", "A", "F"), feat("bg", "B", "G")]);
    const [question] = quizOf(tie, "link", DAY);
    expect(question.text).toBe("Who has worked with both A and B?");
    const right = question.options.filter((o) => checkAnswer(tie, "link", DAY, 0, o.id)!.correct);
    expect(right.map((o) => o.name)).toEqual(["C"]);
    expect(question.options.map((o) => o.name)).not.toContain("D");
  });

  it("keeps only the latest days' quizzes", () => {
    const small = pair([feat("ac", "A", "C")]);
    for (let day = 0; day <= MADE_KEPT; day++) quizOf(small, "link", DAY + day);
    expect(quizOf(small, "link", DAY)).toEqual([]);
    expect(quizMisses(small, "link", DAY, [])).toBeNull();
  });
});

describe("results kept in a browser", () => {
  const raw = JSON.stringify({
    connect: { [DAY]: { score: 3, gaveUp: false, submitted: true, answers: ["a", 2, "b"] }, x: { score: 1 }, [DAY - 1]: { score: -1 } },
    credits: { [DAY - 1]: { score: 0 }, [DAY - 2]: { score: 1.5 } },
    link: "nope",
  });

  it("reads what's valid and leaves out the rest", () => {
    const results = resultsIn(raw);
    expect(results.connect).toEqual({ [DAY]: { score: 3, gaveUp: false, submitted: true, answers: ["a", "b"] } });
    expect(results.credits).toEqual({ [DAY - 1]: { score: 0, gaveUp: false, submitted: false, answers: [] } });
    expect(results.link).toEqual({});
    for (const bad of [null, "{oops", "7"]) expect(resultsIn(bad)).toEqual({ connect: {}, credits: {}, link: {} });
  });

  it("adds a result, counts the streak and totals", () => {
    const results = withResult(raw, "link", DAY - 3, { score: 0, gaveUp: false, submitted: false, answers: [] });
    expect(streakOf(results, DAY)).toBe(1 + 1 + 0);
    expect(streakOf(results, DAY + 1)).toBe(2);
    expect(streakOf(results, DAY + 2)).toBe(0);
    expect(statsOf(results)).toEqual({ days: 3, wins: 1, perfect: 2 });
    const gaveUp = withResult(null, "connect", DAY, { score: 9, gaveUp: true, submitted: false, answers: [] });
    expect(statsOf(gaveUp).wins).toBe(0);
  });

  it("names games, scores and players", () => {
    expect(isGame("connect")).toBe(true);
    expect(isGame("chess")).toBe(false);
    expect(scoreText("connect", 1)).toBe("1 step");
    expect(scoreText("connect", 4)).toBe("4 steps");
    expect(scoreText("credits", 1)).toBe("4 of 5");
    expect(gameHref("link")).toBe("/discover/games/link");
    expect(gameHref("link", "2026-11-28")).toBe("/discover/games/link?day=2026-11-28");
    const id = "00000000-0000-4000-8000-000000000001";
    expect(isPlayer(id)).toBe(true);
    expect(storedPlayer(JSON.stringify(id))).toBe(id);
    for (const bad of [null, "{x", '"short"']) expect(storedPlayer(bad)).toBeNull();
  });
});

describe("storage", () => {
  it("keeps values and ranked lists in memory until they expire", async () => {
    let now = 0;
    const kept = memoryStore(() => now);
    expect(await kept.setNew("k", "v", 10)).toBe(true);
    expect(await kept.setNew("k", "w", 10)).toBe(false);
    await kept.set("k", "x", 10);
    expect(await kept.get("k")).toBe("x");
    await kept.del("k");
    expect(await kept.get("k")).toBeNull();
    expect(await kept.rankNew("r", "b", 2, 10)).toBe(true);
    expect(await kept.rankNew("r", "a", 2, 10)).toBe(true);
    expect(await kept.rankNew("r", "c", 1, 10)).toBe(true);
    expect(await kept.rankNew("r", "c", 0, 10)).toBe(false);
    expect(await kept.top("r", 2)).toEqual([["c", 1], ["a", 2]]);
    expect([await kept.size("r"), await kept.place("r", "b"), await kept.place("r", "z")]).toEqual([3, 2, null]);
    now = 11_000;
    expect([await kept.get("k"), await kept.size("r"), await kept.setNew("k", "v", 10)]).toEqual([null, 0, true]);
  });

  it("speaks Redis's REST commands", async () => {
    const sent: unknown[] = [];
    const replies: unknown[] = ["OK", "OK", "v", 1, 1, 1, ["m", "1.5", "n", "2"], 2, 0, null];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify({ result: replies.shift() }));
    });
    const kept = redisStore("https://redis", "token", fetchImpl as typeof fetch);
    expect(await kept.setNew("k", "v", 5)).toBe(true);
    await kept.set("k", "v", 5);
    expect(await kept.get("k")).toBe("v");
    await kept.del("k");
    expect(await kept.rankNew("r", "m", 1.5, 9)).toBe(true);
    expect(await kept.top("r", 2)).toEqual([["m", 1.5], ["n", 2]]);
    expect(await kept.size("r")).toBe(2);
    expect(await kept.place("r", "m")).toBe(0);
    expect(await kept.setNew("k", "v", 5)).toBe(false);
    expect(sent).toEqual([
      ["SET", "k", "v", "EX", 5, "NX"],
      ["SET", "k", "v", "EX", 5],
      ["GET", "k"],
      ["DEL", "k"],
      ["ZADD", "r", "NX", 1.5, "m"],
      ["EXPIRE", "r", 9],
      ["ZRANGE", "r", 0, 1, "WITHSCORES"],
      ["ZCARD", "r"],
      ["ZRANK", "r", "m"],
      ["SET", "k", "v", "EX", 5, "NX"],
    ]);
    expect(fetchImpl.mock.calls[0][1]!.headers).toMatchObject({ Authorization: "Bearer token" });
    const failing = redisStore("https://redis", "t", (async () => new Response("", { status: 500 })) as typeof fetch);
    await expect(failing.get("k")).rejects.toThrow("Storage returned an error (500).");
  });

  it("uses Redis when configured, memory in development, and nothing in production", () => {
    expect(store({ KV_REST_API_URL: "https://a", KV_REST_API_TOKEN: "t" })).not.toBeNull();
    expect(store({ UPSTASH_REDIS_REST_URL: "https://a", UPSTASH_REDIS_REST_TOKEN: "t" })).not.toBeNull();
    expect(store({ NODE_ENV: "production" })).toBeNull();
    expect(store({})).toBe(store({}));
  });
});

describe("leaderboards", () => {
  it("accepts plain names only", () => {
    expect(cleanName("  Ada   Lovelace ")).toBe("Ada Lovelace");
    expect(cleanName("Zoë_O'Brien-2")).toBe("Zoë_O'Brien-2");
    for (const bad of [7, "A", "x".repeat(25), "<script>", "visit www.site", "me.com", "http fan"]) expect(cleanName(bad)).toBeNull();
  });

  it("ranks lower scores first, ties by who finished first, one entry per player", async () => {
    const kept = memoryStore();
    const start = DAY * 86_400_000;
    expect(await submitScore(kept, "connect", DAY, "p1", "Late", 3, start + 5000)).toEqual({ added: true, place: 0, total: 1 });
    await submitScore(kept, "connect", DAY, "p2", "Early", 3, start + 1000);
    await submitScore(kept, "connect", DAY, "p3", "Best", 2, start + 9000);
    expect(await submitScore(kept, "connect", DAY, "p1", "Again", 1, start + 9999)).toEqual({ added: false, place: 2, total: 3 });
    expect(await readBoard(kept, "connect", DAY, "p2")).toEqual({
      entries: [
        { name: "Best", score: 2 },
        { name: "Early", score: 3 },
        { name: "Late", score: 3 },
      ],
      total: 3,
      mine: 1,
    });
    await kept.del(`board:connect:${DAY}:name:p3`);
    expect((await readBoard(kept, "connect", DAY, null)).entries[0].name).toBe("Someone");
    expect((await readBoard(kept, "connect", DAY, null)).mine).toBeNull();
  });
});
