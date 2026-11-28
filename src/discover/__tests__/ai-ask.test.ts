// AI search: readings mapped onto Ask's questions, the request sent to Claude, failures that fall
// back to the patterns, the cache, the daily limit, and the answers that come of it.
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_MODEL,
  aiAllowed,
  aiClient,
  aiEnabled,
  askWithAi,
  DEFAULT_DAILY_LIMIT,
  forgetReadings,
  INSTRUCTIONS,
  questionOf,
  readWithAi,
  REMEMBERED,
  type Reading,
} from "../lib/ai-ask";
import type { Question } from "../lib/ask";
import { memoryStore, redisStore } from "../lib/store";
import { graph } from "../lib/server";

const blank: Reading = { intent: "unknown", a: "", b: "", song: "", role: "all", type: "any", direction: "none", strongest: false };
const reading = (over: Partial<Reading>): Reading => ({ ...blank, ...over });
const ON = { ANTHROPIC_API_KEY: "key" };

beforeEach(() => forgetReadings());
afterEach(() => vi.restoreAllMocks());

describe("readings as questions", () => {
  it("map each intent, with the names it needs", () => {
    expect(questionOf(reading({ intent: "path", a: "Adele", b: " the artist Drake ", strongest: true }))).toEqual({ intent: "path", a: "Adele", b: "Drake", strongest: true });
    expect(questionOf(reading({ intent: "compare", a: "Adele", b: "Drake" }))).toEqual({ intent: "compare", a: "Adele", b: "Drake" });
    expect(questionOf(reading({ intent: "credits", song: " Umbrella by Rihanna ", role: "producer" }))).toEqual({ intent: "credits", song: "Umbrella by Rihanna", role: "producer" });
    expect(questionOf(reading({ intent: "collaborators", a: "Drake" }))).toEqual({ intent: "collaborators", artist: "Drake", type: null, direction: null });
    expect(questionOf(reading({ intent: "collaborators", a: "Drake", type: "features", direction: "produced for them" }))).toEqual({ intent: "collaborators", artist: "Drake", type: "features", direction: null });
    expect(questionOf(reading({ intent: "collaborators", a: "Drake", type: "production" }))).toMatchObject({ direction: "produced by them" });
    expect(questionOf(reading({ intent: "collaborators", a: "Drake", type: "production", direction: "produced for them" }))).toMatchObject({ direction: "produced for them" });
    expect(questionOf(reading({ intent: "sampled", a: "James Brown" }))).toEqual({ intent: "sampled", artist: "James Brown" });
    expect(questionOf(reading({ intent: "connections", a: "Bon Iver" }))).toEqual({ intent: "connections", artist: "Bon Iver" });
    expect(questionOf(reading({ intent: "lookup", a: "ABBA" }))).toEqual({ intent: "lookup", text: "ABBA" });
  });

  it("are nothing when unknown or missing a name", () => {
    for (const r of [blank, reading({ intent: "path", a: "Adele" }), reading({ intent: "compare", b: "x" }), reading({ intent: "credits" }), reading({ intent: "collaborators" }), reading({ intent: "sampled" }), reading({ intent: "connections" }), reading({ intent: "lookup" })])
      expect(questionOf(r), r.intent).toBeNull();
    expect((questionOf(reading({ intent: "lookup", a: "x".repeat(500) })) as { text: string }).text).toHaveLength(120);
  });
});

describe("reading with Claude", () => {
  const client = (reply: () => unknown) => {
    const parse = vi.fn(async (params: unknown) => {
      void params;
      return reply();
    });
    return { client: { beta: { messages: { parse } } } as unknown as Pick<Anthropic, "beta">, parse };
  };

  it("asks for a structured reading, with the question in its own turn after the cached instructions", async () => {
    const { client: fake, parse } = client(() => ({ stop_reason: "end_turn", parsed_output: reading({ intent: "lookup", a: "Adele" }) }));
    expect(await readWithAi("adel", fake)).toEqual({ intent: "lookup", text: "Adele" });
    const params = parse.mock.calls[0][0] as Record<string, unknown>;
    expect(params).toMatchObject({
      model: AI_MODEL,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "<question>adel</question>" }],
    });
    expect((params.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    await readWithAi("x".repeat(300), fake);
    expect((parse.mock.calls[1][0] as { messages: { content: string }[] }).messages[0].content).toHaveLength(200 + "<question></question>".length);
  });

  it("gives up on a declined, unparsed or unknown reading", async () => {
    expect(await readWithAi("q", client(() => ({ stop_reason: "refusal", parsed_output: null })).client)).toBeUndefined();
    expect(await readWithAi("q", client(() => ({ stop_reason: "end_turn", parsed_output: null })).client)).toBeUndefined();
    expect(await readWithAi("q", client(() => ({ stop_reason: "end_turn", parsed_output: blank })).client)).toBeNull();
  });

  it("logs failures without the question, and gives up", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const headers = new Headers();
    const failures = [
      new Anthropic.RateLimitError(429, {}, "slow down", headers),
      new Anthropic.APIConnectionTimeoutError(),
      new Anthropic.InternalServerError(500, {}, "oops", headers),
      new SyntaxError("bad JSON"),
    ];
    for (const failure of failures)
      expect(
        await readWithAi("my private question", client(() => {
          throw failure;
        }).client),
      ).toBeUndefined();
    expect(logged.mock.calls.map(([line]) => line)).toEqual([
      "[ask] AI reading rate limited",
      "[ask] AI reading didn’t answer in time",
      "[ask] AI reading failed (500)",
      "[ask] AI reading failed: SyntaxError",
    ]);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("private");
  });

  it("uses one client per server instance, retrying once and waiting a while", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const made = aiClient();
    expect(made).toBeInstanceOf(Anthropic);
    expect(aiClient()).toBe(made);
    expect(made.maxRetries).toBe(1);
    expect(made.timeout).toBe(12_000);
    vi.unstubAllEnvs();
  });

  it("is on with a key or token", () => {
    expect(aiEnabled({ ANTHROPIC_API_KEY: " k " })).toBe(true);
    expect(aiEnabled({ ANTHROPIC_AUTH_TOKEN: "t" })).toBe(true);
    expect(aiEnabled({ ANTHROPIC_API_KEY: " " })).toBe(false);
    expect(aiEnabled({})).toBe(false);
  });
});

describe("the daily limit", () => {
  it("counts readings per day in shared storage, up to the limit set", async () => {
    const kept = memoryStore();
    const env = { AI_DAILY_LIMIT: "2" };
    expect([await aiAllowed(kept, env, 0), await aiAllowed(kept, env, 1), await aiAllowed(kept, env, 2)]).toEqual([true, true, false]);
    expect(await aiAllowed(kept, env, 86_400_000)).toBe(true);
    expect(await aiAllowed(kept, { AI_DAILY_LIMIT: "0" }, 2 * 86_400_000)).toBe(false);
  });

  it("uses the default for an odd limit, and counts per instance without storage", async () => {
    for (let i = 0; i < DEFAULT_DAILY_LIMIT; i++) await aiAllowed(null, { AI_DAILY_LIMIT: "lots" }, 0);
    expect(await aiAllowed(null, {}, 0)).toBe(false);
    expect(await aiAllowed(null, {}, 86_400_000)).toBe(true);
  });

  it("counts in Redis with INCR, starting each day's count with an expiry", async () => {
    const sent: unknown[] = [];
    const replies = [1, 1, 2];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify({ result: replies.shift() }));
    });
    const kept = redisStore("https://redis", "t", fetchImpl as typeof fetch);
    expect(await kept.increment("k", 9)).toBe(1);
    expect(await kept.increment("k", 9)).toBe(2);
    expect(sent).toEqual([["INCR", "k"], ["EXPIRE", "k", 9], ["INCR", "k"]]);
  });

  it("keeps a count's first expiry in memory", async () => {
    let now = 0;
    const kept = memoryStore(() => now);
    await kept.increment("k", 10);
    now = 9000;
    expect(await kept.increment("k", 10)).toBe(2);
    now = 10_001;
    expect(await kept.increment("k", 10)).toBe(1);
  });
});

describe("answers with AI search", () => {
  const g = graph();
  const reads = (question: Question | null | undefined) => vi.fn(async (raw: string) => (void raw, question));

  it("leaves questions the patterns answer alone, and everything when AI is off", async () => {
    const read = reads({ intent: "lookup", text: "Adele" });
    expect((await askWithAi(g, "Who produced Umbrella?", { read, env: ON, kept: memoryStore() })).ai).toBe(false);
    expect((await askWithAi(g, "what is the meaning of life", { read, env: {}, kept: memoryStore() })).answer.kind).toBe("unknown");
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a question the patterns can't, and answers it from the catalog", async () => {
    const read = reads({ intent: "credits", song: "Umbrella", role: "producer" });
    const asked = await askWithAi(g, "the beat on that rihanna song with the rain", { read, env: ON, kept: memoryStore() });
    expect(asked.ai).toBe(true);
    expect(asked.answer).toMatchObject({ kind: "credits", reading: "Who produced “Umbrella”" });
    await askWithAi(g, "The beat on that Rihanna song with the rain!", { read, env: ON, kept: memoryStore() });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("fixes a misspelled name the patterns couldn't find", async () => {
    const asked = await askWithAi(g, "How is Jonny Kash connected to Rihana?", {
      read: reads({ intent: "path", a: "Johnny Cash", b: "Rihanna", strongest: false }),
      env: ON,
      kept: memoryStore(),
    });
    expect(asked.ai).toBe(true);
    expect(asked.answer).toMatchObject({ kind: "path", reading: "How Johnny Cash is connected to Rihanna" });
  });

  it("turns a search that found nothing into a question", async () => {
    const asked = await askWithAi(g, "songs drake produced for", { read: reads({ intent: "collaborators", artist: "Drake", type: "production", direction: "produced for them" }), env: ON, kept: memoryStore() });
    expect(asked).toMatchObject({ ai: true, answer: { kind: "collaborators" } });
  });

  it("keeps the patterns' answer when the reading gets no further", async () => {
    const kept = memoryStore();
    expect((await askWithAi(g, "what is the meaning of life", { read: reads(null), env: ON, kept })).ai).toBe(false);
    expect((await askWithAi(g, "what is the meaning of life", { read: reads({ intent: "path", a: "x" } as never), env: ON, kept })).ai).toBe(false);
    const stillMissing = await askWithAi(g, "How is Adele connected to Qwzx?", { read: reads({ intent: "path", a: "Adele", b: "Qwzx", strongest: false }), env: ON, kept });
    expect(stillMissing).toMatchObject({ ai: false, answer: { kind: "missing" } });
    const nothingFound = await askWithAi(g, "qwzx vbnm plok", { read: reads({ intent: "lookup", text: "qwzx" }), env: ON, kept });
    expect(nothingFound.ai).toBe(false);
    const nowMissing = await askWithAi(g, "tell me something about qwzx please now", { read: reads({ intent: "sampled", artist: "Qwzx" }), env: ON, kept });
    expect(nowMissing).toMatchObject({ ai: true, answer: { kind: "missing" } });
  });

  it("tries again after a reading failed, but not over the day's limit", async () => {
    const read = reads(undefined);
    const kept = memoryStore();
    await askWithAi(g, "what is the meaning of life", { read, env: ON, kept });
    await askWithAi(g, "what is the meaning of life", { read, env: ON, kept });
    expect(read).toHaveBeenCalledTimes(2);
    await askWithAi(g, "why do we sing", { read, env: { ...ON, AI_DAILY_LIMIT: "2" }, kept });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("remembers a limited number of readings", async () => {
    const read = reads(null);
    for (let i = 0; i <= REMEMBERED; i++) await askWithAi(g, `what is the meaning of ${i} things`, { read, env: ON, kept: memoryStore() });
    await askWithAi(g, "what is the meaning of 0 things", { read, env: ON, kept: memoryStore() });
    expect(read).toHaveBeenCalledTimes(REMEMBERED + 2);
  });
});
