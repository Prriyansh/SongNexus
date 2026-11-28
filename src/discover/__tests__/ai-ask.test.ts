// AI search: readings mapped onto Ask's questions, the request sent to Gemini's free models, falling
// back across them, the cache, the daily limit, and the answers that come of it.
import { GoogleGenAI } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiAllowed,
  aiClient,
  aiEnabled,
  askWithAi,
  DEFAULT_DAILY_LIMIT,
  forgetReadings,
  FREE_MODELS,
  INSTRUCTIONS,
  modelsOf,
  questionOf,
  readingIn,
  readWithAi,
  REMEMBERED,
  SCHEMA,
  type Gemini,
  type Reading,
} from "../lib/ai-ask";
import type { Question } from "../lib/ask";
import { memoryStore, redisStore } from "../lib/store";
import { graph } from "../lib/server";

const blank: Reading = { intent: "unknown", a: "", b: "", song: "", role: "all", type: "any", direction: "none", strongest: false };
const reading = (over: Partial<Reading>): Reading => ({ ...blank, ...over });
const ON = { GEMINI_API_KEY: "key" };

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

describe("reading with Gemini's free models", () => {
  type Reply = { output_text?: string } | { status: number } | Error;
  /** A stand-in client answering each call with the next reply: an interaction, an error status, or an error. */
  const gemini = (...replies: Reply[]) => {
    const create = vi.fn(async (params: Record<string, unknown>, options: Record<string, unknown>) => {
      void [params, options];
      const reply = replies.shift()!;
      if (reply instanceof Error) throw reply;
      if ("status" in reply) throw Object.assign(new Error(`HTTP ${reply.status}`), { status: reply.status });
      return reply;
    });
    return { client: { interactions: { create } } as unknown as Gemini, create };
  };
  const json = (r: Partial<Reading>) => ({ output_text: JSON.stringify(reading(r)) });
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("asks the lightest free model first, for a reading that fits the schema, kept nowhere", async () => {
    const { client, create } = gemini(json({ intent: "lookup", a: "Adele" }));
    expect(await readWithAi("adel", client)).toEqual({ intent: "lookup", text: "Adele" });
    const [params, options] = create.mock.calls[0];
    expect(params).toEqual({
      model: FREE_MODELS[0],
      system_instruction: INSTRUCTIONS,
      input: "Question: adel\nReading:",
      response_format: { type: "text", mime_type: "application/json", schema: SCHEMA },
      generation_config: { temperature: 0, max_output_tokens: 400, thinking_level: "minimal" },
      store: false,
    });
    expect(options).toMatchObject({ retries: { strategy: "none" } });
    expect(options.timeout_ms).toBeLessThanOrEqual(12_000);
    expect(SCHEMA).not.toHaveProperty("$schema");
    expect(SCHEMA).toMatchObject({ type: "object", additionalProperties: false });
    await readWithAi("x".repeat(300), gemini(json({})).client);
  });

  it("moves to the next free model when one is over its limit, unavailable or gives a bad reading", async () => {
    const logged = quiet();
    const { client, create } = gemini({ status: 429 }, { output_text: "not json" }, json({ intent: "sampled", a: "James Brown" }));
    expect(await readWithAi("my private question", client)).toEqual({ intent: "sampled", artist: "James Brown" });
    expect(create.mock.calls.map(([p]) => p.model)).toEqual(FREE_MODELS);
    expect((create.mock.calls[2][0].generation_config as { thinking_level: string }).thinking_level).toBe("low");
    expect(logged.mock.calls.map(([line]) => line)).toEqual([
      `[ask] ${FREE_MODELS[0]} failed (429)`,
      `[ask] ${FREE_MODELS[1]} gave a reading that doesn’t fit`,
    ]);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("private");
    const tried = gemini({ status: 404 }, { status: 503 }, {});
    expect(await readWithAi("q", tried.client)).toBeUndefined();
    expect(tried.create).toHaveBeenCalledTimes(3);
  });

  it("stops at a refusal it can't get past, or a failure without a status", async () => {
    quiet();
    const refused = gemini({ status: 400 }, json({ intent: "lookup", a: "x" }));
    expect(await readWithAi("q", refused.client)).toBeUndefined();
    expect(refused.create).toHaveBeenCalledTimes(1);
    const timedOut = gemini(new TypeError("timed out"), json({ intent: "lookup", a: "x" }));
    expect(await readWithAi("q", timedOut.client)).toBeUndefined();
    expect(timedOut.create).toHaveBeenCalledTimes(1);
  });

  it("gives every model only the time left, and none once it's gone", async () => {
    quiet();
    let clock = 0;
    const { create } = gemini({ status: 429 }, { status: 429 }, json({ intent: "lookup", a: "x" }));
    const slow = vi.fn(async (params: Record<string, unknown>, options: Record<string, unknown>) => {
      clock += 7_000;
      return create(params, options);
    });
    expect(await readWithAi("q", { interactions: { create: slow } } as unknown as Gemini, FREE_MODELS, () => clock)).toBeUndefined();
    expect(slow.mock.calls.map(([, o]) => o.timeout_ms)).toEqual([12_000, 5_000]);
  });

  it("reads JSON in a code fence, and nothing that doesn't fit", () => {
    expect(readingIn('```json\n{"intent":"lookup","a":"ABBA","b":"","song":"","role":"all","type":"any","direction":"none","strongest":false}\n```')).toMatchObject({ a: "ABBA" });
    expect(readingIn(JSON.stringify({ intent: "dance" }))).toBeNull();
    expect(readingIn("{")).toBeNull();
    expect(readingIn(undefined)).toBeNull();
    expect(readWithAi).toBeTypeOf("function");
  });

  it("is on with a Gemini or Google key, and tries the models GEMINI_MODELS names", () => {
    expect(aiEnabled({ GEMINI_API_KEY: " k " })).toBe(true);
    expect(aiEnabled({ GOOGLE_API_KEY: "k" })).toBe(true);
    expect(aiEnabled({ GEMINI_API_KEY: " " })).toBe(false);
    expect(aiEnabled({})).toBe(false);
    expect(modelsOf({ GEMINI_MODELS: " gemini-4-hydrogen , Bad Name!, gemini-3.6-flash" })).toEqual(["gemini-4-hydrogen", "gemini-3.6-flash"]);
    expect(modelsOf({ GEMINI_MODELS: "!!" })).toEqual(FREE_MODELS);
    expect(modelsOf({})).toEqual(FREE_MODELS);
  });

  it("uses one client per server instance", () => {
    const made = aiClient({ GEMINI_API_KEY: "test-key" });
    expect(made).toBeInstanceOf(GoogleGenAI);
    expect(aiClient({ GOOGLE_API_KEY: "other" })).toBe(made);
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
