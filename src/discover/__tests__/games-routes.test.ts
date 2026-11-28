// The games' routes: each step and answer checked here, scores worked out from the answers.
import { afterEach, describe, expect, it, vi } from "vitest";

const none = vi.hoisted(() => ({ puzzle: false }));
vi.mock("@/discover/lib/games", async (actual) => {
  const real = await actual<typeof import("@/discover/lib/games")>();
  return { ...real, puzzleOf: (...args: Parameters<typeof real.puzzleOf>) => (none.puzzle ? null : real.puzzleOf(...args)) };
});
import { POST as answer } from "@/app/api/discover/games/answer/route";
import { GET as boardRoute } from "@/app/api/discover/games/board/route";
import { dayOf } from "@/app/api/discover/games/request";
import { POST as score } from "@/app/api/discover/games/score/route";
import { POST as stepRoute } from "@/app/api/discover/games/step/route";
import { dayNumber, LAUNCH_DAY } from "../lib/days";
import { checkAnswer, puzzleOf, quizOf } from "../lib/games";
import { findPath } from "../lib/paths";
import { graph } from "../lib/server";
import { DEFAULT_CATEGORIES } from "../lib/types";

const g = graph();
const c = g.catalog;
const DAY = LAUNCH_DAY;
const PLAYER = "00000000-0000-4000-8000-0000000000aa";
const post = (route: (r: Request) => Promise<Response>, body: unknown) =>
  route(new Request("http://x/api", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const json = async (response: Response) => ({ status: response.status, body: await response.json() });
const puzzle = puzzleOf(g, DAY)!;
const chain = findPath(g, c.artistAt.get(puzzle.start.id)!, c.artistAt.get(puzzle.target.id)!, {
  categories: DEFAULT_CATEGORIES,
})!.map((at) => c.artists[at].id);

afterEach(() => vi.unstubAllEnvs());

describe("reading requests", () => {
  it("accepts days from launch to today only", () => {
    expect(dayOf(DAY)).toBe(DAY);
    expect(dayOf(String(DAY))).toBe(DAY);
    for (const bad of [DAY - 1, dayNumber(Date.now()) + 1, 1.5, "x", null]) expect(dayOf(bad)).toBeNull();
  });
});

describe("a Connect step", () => {
  it("says whether two artists worked together, with the credit, and when the target is reached", async () => {
    const first = await json(await post(stepRoute, { day: DAY, from: chain[0], guess: chain[1] }));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ linked: true, reached: chain.length === 2 });
    expect(first.body.reason.text).toBeTruthy();
    const last = await json(await post(stepRoute, { day: DAY, from: chain.at(-2), guess: chain.at(-1) }));
    expect(last.body.reached).toBe(true);
    const same = await json(await post(stepRoute, { day: DAY, from: chain[0], guess: chain[0] }));
    expect(same.body).toEqual({ linked: false, reason: null, reached: false });
  });

  it("refuses other days, unknown artists and bodies that aren't JSON objects", async () => {
    expect((await post(stepRoute, { day: DAY - 1, from: chain[0], guess: chain[1] })).status).toBe(400);
    expect((await post(stepRoute, { day: DAY, from: chain[0], guess: "nobody" })).status).toBe(400);
    expect((await post(stepRoute, { day: DAY, from: 3, guess: chain[1] })).status).toBe(400);
    expect((await post(stepRoute, "{not json")).status).toBe(400);
    expect((await post(stepRoute, [1, 2])).status).toBe(400);
  });

  it("says when a day has no puzzle", async () => {
    none.puzzle = true;
    expect((await post(stepRoute, { day: DAY, from: chain[0], guess: chain[1] })).status).toBe(404);
    none.puzzle = false;
  });
});

describe("a quiz answer", () => {
  it("checks a choice and shows the proof", async () => {
    const [first] = quizOf(g, "credits", DAY);
    const reply = await json(await post(answer, { game: "credits", day: DAY, question: 0, choice: first.options[0].id }));
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(checkAnswer(g, "credits", DAY, 0, first.options[0].id));
  });

  it("refuses other games, days and questions", async () => {
    for (const body of [
      { game: "connect", day: DAY, question: 0, choice: "x" },
      { game: "link", day: DAY - 1, question: 0, choice: "x" },
      { game: "link", day: DAY, question: 0.5, choice: "x" },
      { game: "link", day: DAY, question: 0, choice: 4 },
      { game: "link", day: DAY, question: 99, choice: "x" },
    ])
      expect((await post(answer, body)).status, JSON.stringify(body)).toBe(400);
  });
});

describe("scores", () => {
  const send = (body: Record<string, unknown>) =>
    post(score, { game: "connect", day: DAY, player: PLAYER, name: "Ada", answers: chain, ...body });

  it("works the score out from the answers and puts it on the board once", async () => {
    const first = await json(await send({}));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ score: puzzle.par, added: true, place: 0 });
    expect((await json(await send({ name: "Ada again" }))).body.added).toBe(false);
    const board = await json(await boardRoute(new Request(`http://x/api?game=connect&day=${DAY}&player=${PLAYER}`)));
    expect(board.body.entries[0]).toEqual({ name: "Ada", score: puzzle.par });
    expect(board.body.mine).toBe(0);
    const anonymous = await json(await boardRoute(new Request(`http://x/api?game=connect&day=${DAY}&player=nope`)));
    expect(anonymous.body.mine).toBeNull();
  });

  it("refuses bad games, players, names and answers", async () => {
    expect((await send({ game: "chess" })).status).toBe(400);
    expect((await send({ game: 5 })).status).toBe(400);
    expect((await send({ player: "me" })).status).toBe(400);
    const named = await json(await send({ name: "x" }));
    expect([named.status, named.body.error]).toEqual([400, "Pick a name of 2 to 24 letters, numbers and spaces."]);
    expect((await send({ answers: chain.slice(0, -1) })).status).toBe(400);
    expect((await send({ answers: "all of them" })).status).toBe(400);
    expect((await send({ answers: [1, 2] })).status).toBe(400);
  });

  it("says leaderboards aren't set up in production without storage", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    expect((await send({})).status).toBe(503);
    expect((await boardRoute(new Request(`http://x/api?game=connect&day=${DAY}`))).status).toBe(503);
  });

  it("refuses a board for a game or day that doesn't exist", async () => {
    expect((await boardRoute(new Request(`http://x/api?game=chess&day=${DAY}`))).status).toBe(400);
    expect((await boardRoute(new Request("http://x/api?game=link"))).status).toBe(400);
    expect((await boardRoute(new Request(`http://x/api?day=${DAY}`))).status).toBe(400);
  });
});
