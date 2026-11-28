// AI search for Ask, on Gemini's free tier. When the patterns can't read a question, a name in it
// isn't found, or a search finds nothing, a free Gemini model reads the question into the same fixed
// set of questions. The model only interprets: it picks the question and spells the names. Every
// fact in the answer still comes from the catalog, and the page says the question was read by AI.
// Needs GEMINI_API_KEY (a free key from Google AI Studio); without it Ask works as before.
// Server only.
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { answerQuestion, ask, nameOf, type Answer, type Question } from "./ask";
import { dayNumber } from "./days";
import type { Graph } from "./graph";
import { normalize } from "./search";
import { store, type Store } from "./store";

/**
 * Free-tier models, tried in turn: the lightest first (fastest, and the most generous free limits),
 * the next when one is over its free limit, unavailable, or gives a reading that doesn't fit.
 * GEMINI_MODELS (comma-separated) replaces the list.
 */
export const FREE_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"];
/** Thinking kept to the least each model allows: reading a question needs little of it. */
const THINKING: Record<string, "minimal" | "low"> = { "gemini-3.8-flash": "low" };
/** A search waits this long in all for a reading, then answers without one. */
export const AI_TIMEOUT_MS = 12_000;
/** Readings a day, kept well inside the free tier's daily limits. AI_DAILY_LIMIT changes it. */
export const DEFAULT_DAILY_LIMIT = 200;
export const MAX_QUESTION = 200;
const MAX_NAME = 120;

/** A reading: one of Ask's questions, every field present. */
export const Reading = z.object({
  intent: z.enum(["path", "compare", "credits", "collaborators", "sampled", "connections", "lookup", "unknown"]),
  a: z.string(),
  b: z.string(),
  song: z.string(),
  role: z.enum(["producer", "featured", "performer", "all"]),
  type: z.enum(["any", "features", "production", "bands"]),
  direction: z.enum(["none", "produced by them", "produced for them"]),
  strongest: z.boolean(),
});
export type Reading = z.infer<typeof Reading>;
/** The reading as JSON Schema, without `$schema`, which Gemini's subset of JSON Schema leaves out. */
export const SCHEMA = Object.fromEntries(Object.entries(z.toJSONSchema(Reading)).filter(([key]) => key !== "$schema"));

const blank = { a: "", b: "", song: "", role: "all", type: "any", direction: "none", strongest: false };
const example = (question: string, reading: Partial<Reading>) =>
  `Question: ${question}\nReading: ${JSON.stringify({ ...blank, ...reading })}`;

// Small free models follow examples better than rules, so the instructions are mostly examples.
export const INSTRUCTIONS = `You read search questions for Song Nexus, a catalog of artists, songs and the credits that connect them (who performed, produced, was featured on, played on or sampled what, and which bands artists were in).

Read the question into exactly one intent, and write each name the way it is usually written. Never answer the question: the app answers it from its catalog.

Intents:
- path: how two artists are connected (a, b). strongest is true only if they ask for the closest or strongest connection.
- compare: what two artists or two songs have in common (a, b).
- credits: who is credited on one song. song is the title, plus " by " and the artist if named. role: producer, featured (guests), performer (who sang or released it), or all.
- collaborators: who one artist (a) worked with. type: features, production, bands, or any. For production, direction is "produced by them" (who produced for the artist) or "produced for them" (whom the artist produced for).
- sampled: who sampled one artist (a).
- connections: artists connected to, or like, one artist (a).
- lookup: the question is only a name (a).
- unknown: anything else: opinions, lyrics, meanings, charts, sales, news, tours, moods.

Fix misspelled names. Name an artist the question only describes only if the description is unambiguous; otherwise use unknown. Fields that don't apply stay as in the examples.

${[
  example("how r jonny cash n rihana linked", { intent: "path", a: "Johnny Cash", b: "Rihanna" }),
  example("closest connection between adele and drake", { intent: "path", a: "Adele", b: "Drake", strongest: true }),
  example("what do beyonce and jay z have in common", { intent: "compare", a: "Beyoncé", b: "JAY-Z" }),
  example("who made the beat on umbrella", { intent: "credits", song: "Umbrella", role: "producer" }),
  example("whos the guest on monster by kanye", { intent: "credits", song: "Monster by Kanye West", role: "featured" }),
  example("taylor swift's producers", { intent: "collaborators", a: "Taylor Swift", type: "production", direction: "produced by them" }),
  example("which bands was dave grohl in", { intent: "collaborators", a: "Dave Grohl", type: "bands" }),
  example("who sampled james brown", { intent: "sampled", a: "James Brown" }),
  example("artists similar to bon iver", { intent: "connections", a: "Bon Iver" }),
  example("kendrik lamar", { intent: "lookup", a: "Kendrick Lamar" }),
  example("what is the saddest song ever", { intent: "unknown" }),
].join("\n\n")}`;

/** The Gemini API key, from GEMINI_API_KEY or GOOGLE_API_KEY; "" without one. */
const keyOf = (env: Record<string, string | undefined>) => env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || "";

export const aiEnabled = (env: Record<string, string | undefined> = process.env) => keyOf(env) !== "";

/** The free models to try, from GEMINI_MODELS when it names any. */
export function modelsOf(env: Record<string, string | undefined> = process.env): string[] {
  const named = (env.GEMINI_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => /^[a-z0-9][a-z0-9.-]{2,60}$/.test(m));
  return named.length ? named : FREE_MODELS;
}

export type Gemini = Pick<GoogleGenAI, "interactions">;
let shared: Gemini | null = null;

/** One client per server instance. */
export function aiClient(env: Record<string, string | undefined> = process.env): Gemini {
  shared ??= new GoogleGenAI({ apiKey: keyOf(env) });
  return shared;
}

const name = (text: string) => nameOf(text.slice(0, MAX_NAME));

/** A reading as one of Ask's questions; null when it's unknown or misses a name it needs. */
export function questionOf(reading: Reading): Question | null {
  const [a, b, song] = [name(reading.a), name(reading.b), reading.song.trim().slice(0, MAX_NAME)];
  switch (reading.intent) {
    case "path":
      return a && b ? { intent: "path", a, b, strongest: reading.strongest } : null;
    case "compare":
      return a && b ? { intent: "compare", a, b } : null;
    case "credits":
      return song ? { intent: "credits", song, role: reading.role } : null;
    case "collaborators": {
      if (!a) return null;
      const type = reading.type === "any" ? null : reading.type;
      // Production questions always say who produced for whom; most ask who produced for them.
      const direction = type !== "production" ? null : reading.direction === "none" ? "produced by them" : reading.direction;
      return { intent: "collaborators", artist: a, type, direction };
    }
    case "sampled":
    case "connections":
      return a ? { intent: reading.intent, artist: a } : null;
    case "lookup":
      return a ? { intent: "lookup", text: a } : null;
    default:
      return null;
  }
}

/** A model's text as a reading, if it is one: free models sometimes wrap JSON in a code fence. */
export function readingIn(text: string | undefined): Reading | null {
  const json = (text ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    const found = Reading.safeParse(JSON.parse(json));
    return found.success ? found.data : null;
  } catch {
    return null;
  }
}

/** Over its free limit, overloaded, or not served: worth trying the next free model. */
const passOn = (status: number | undefined) => status === 429 || status === 404 || (status !== undefined && status >= 500);

/**
 * Reads a question with the free models in turn. Null when it isn't one the catalog can answer;
 * undefined when no model could read it (limits, failures, time), so it can be tried again later.
 */
export async function readWithAi(
  question: string,
  client: Gemini = aiClient(),
  models: string[] = modelsOf(),
  now: () => number = Date.now,
): Promise<Question | null | undefined> {
  const deadline = now() + AI_TIMEOUT_MS;
  for (const model of models) {
    const left = deadline - now();
    if (left <= 0) break;
    try {
      const interaction = await client.interactions.create(
        {
          model,
          system_instruction: INSTRUCTIONS,
          input: `Question: ${question.slice(0, MAX_QUESTION)}\nReading:`,
          response_format: { type: "text", mime_type: "application/json", schema: SCHEMA },
          generation_config: { temperature: 0, max_output_tokens: 400, thinking_level: THINKING[model] ?? "minimal" },
          // Nothing kept on Google's side once the reading is back.
          store: false,
        },
        { timeout_ms: left, retries: { strategy: "none" } },
      );
      const reading = readingIn(interaction.output_text);
      if (reading) return questionOf(reading);
      console.error(`[ask] ${model} gave a reading that doesn’t fit`);
    } catch (error) {
      // Logged without the question: it's what someone typed.
      const status = (error as { status?: number }).status;
      console.error(`[ask] ${model} failed${status ? ` (${status})` : `: ${(error as Error).name}`}`);
      if (!passOn(status)) return undefined;
    }
  }
  return undefined;
}

const counted = new Map<number, number>();

/** Whether today's readings are still under the limit; counts this one. */
export async function aiAllowed(kept: Store | null, env: Record<string, string | undefined>, now: number): Promise<boolean> {
  const set = env.AI_DAILY_LIMIT?.trim();
  const limit = set && /^\d+$/.test(set) ? Number(set) : DEFAULT_DAILY_LIMIT;
  const day = dayNumber(now);
  // Without shared storage each server instance counts its own.
  const used = kept ? await kept.increment(`ai:readings:${day}`, 2 * 86_400) : (counted.get(day) ?? 0) + 1;
  if (!kept) counted.set(day, used);
  return used <= limit;
}

/** Readings already made, so the same question isn't read (or counted) twice. */
const remembered = new Map<string, Question | null>();
export const REMEMBERED = 500;

/** Forgets readings and counts. For tests. */
export function forgetReadings() {
  remembered.clear();
  counted.clear();
}

type Options = {
  read?: (question: string) => Promise<Question | null | undefined>;
  kept?: Store | null;
  env?: Record<string, string | undefined>;
  now?: number;
};

export type Asked = { answer: Answer; ai: boolean };

/** Answers like `ask`, reading the question with AI when the patterns get nowhere. */
export async function askWithAi(g: Graph, raw: string, options: Options = {}): Promise<Asked> {
  const { read = readWithAi, kept = store(), env = process.env, now = Date.now() } = options;
  const plain = ask(g, raw);
  const nowhere = (a: Answer) => a.kind === "unknown" || (a.kind === "lookup" && !a.results.length);
  if (!(nowhere(plain) || plain.kind === "missing") || !aiEnabled(env)) return { answer: plain, ai: false };
  const key = normalize(raw);
  let question = remembered.get(key);
  if (question === undefined) {
    if (!(await aiAllowed(kept, env, now))) return { answer: plain, ai: false };
    question = await read(raw);
    if (question === undefined) return { answer: plain, ai: false };
    if (remembered.size >= REMEMBERED) remembered.delete(remembered.keys().next().value!);
    remembered.set(key, question);
  }
  if (!question) return { answer: plain, ai: false };
  const smart = answerQuestion(g, question);
  // A reading that gets no further than the patterns did isn't worth showing.
  if (nowhere(smart) || (smart.kind === "missing" && plain.kind === "missing")) return { answer: plain, ai: false };
  return { answer: smart, ai: true };
}
