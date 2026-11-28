// AI search for Ask. When the patterns can't read a question, a name in it isn't found, or a search
// finds nothing, Claude reads the question into the same fixed set of questions. The model only
// interprets: it picks the question and spells the names. Every fact in the answer still comes
// from the catalog, and the page says the question was read by AI. Needs ANTHROPIC_API_KEY;
// without it Ask works as before. Server only.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { answerQuestion, ask, nameOf, type Answer, type Question } from "./ask";
import { dayNumber } from "./days";
import type { Graph } from "./graph";
import { normalize } from "./search";
import { store, type Store } from "./store";

export const AI_MODEL = "claude-opus-5-5";
/** A search waits this long for a reading, then answers without one. */
export const AI_TIMEOUT_MS = 12_000;
/** Readings a day, so a busy or abused page can't run up the bill. AI_DAILY_LIMIT changes it. */
export const DEFAULT_DAILY_LIMIT = 1000;
export const MAX_QUESTION = 200;
const MAX_NAME = 120;

/** What the model returns: one of Ask's questions, every field present (structured outputs). */
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

// Stable, so it is cached across requests; the question comes after it, in the user turn.
export const INSTRUCTIONS = `You read search questions for Song Nexus, a catalog of artists, songs and the credits that connect them: who performed, produced, was featured on, played on or sampled what, and which bands artists were in.

Your only job is to read the question into one of the intents below and to write the names the way they are usually written. Never answer the question yourself: the app answers it from its catalog, and anything you add beyond the reading is thrown away.

Intents:
- path: how two artists are connected. a and b are the two artists. strongest is true only if they ask for the closest or strongest working relationships rather than the fewest steps.
- compare: what two artists, or two songs, have in common. a and b are the two.
- credits: who is credited on one song. song is its title, followed by " by " and the artist if the question names one. role is producer (who produced it), featured (guest artists), performer (who sang or released it) or all.
- collaborators: who one artist worked with. a is the artist. type is features (performed with, featured), production, bands (bands or projects they were in) or any. For production, direction is "produced by them" when asking who produced for the artist, and "produced for them" when asking whom the artist produced for.
- sampled: who sampled one artist. a is the artist.
- connections: artists connected to, or like, one artist. a is the artist.
- lookup: the question is only the name of an artist, song, label or genre. a is that name.
- unknown: anything the credits can't answer, such as opinions, lyrics, meanings, charts, sales, news, tours, or recommendations by mood or genre alone.

Rules:
- Correct misspellings of names ("Rihana" is "Rihanna", "Jonny Cash" is "Johnny Cash").
- If the question describes an artist or song instead of naming it, name it only when the description is unambiguous; otherwise choose unknown.
- Leave fields that don't apply as empty strings, role "all", type "any", direction "none" and strongest false.`;

export const aiEnabled = (env: Record<string, string | undefined> = process.env) =>
  Boolean(env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim());

let shared: Anthropic | null = null;

/** One client per server instance: a failed request is retried once, and none waits too long. */
export function aiClient(): Anthropic {
  shared ??= new Anthropic({ maxRetries: 1, timeout: AI_TIMEOUT_MS });
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

/**
 * Reads a question with Claude. Null when it isn't one the catalog can answer; undefined when it
 * couldn't be read (the service failed, timed out or declined), so it can be tried again later.
 */
export async function readWithAi(
  question: string,
  client: Pick<Anthropic, "beta"> = aiClient(),
): Promise<Question | null | undefined> {
  try {
    const response = await client.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 4096,
      // A question a safety check declines is retried on the fallback model it picks.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(Reading) },
      system: [{ type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `<question>${question.slice(0, MAX_QUESTION)}</question>` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return undefined;
    return questionOf(response.parsed_output);
  } catch (error) {
    // Logged without the question: it's what someone typed.
    if (error instanceof Anthropic.RateLimitError) console.error("[ask] AI reading rate limited");
    else if (error instanceof Anthropic.APIConnectionError) console.error("[ask] AI reading didn’t answer in time");
    else if (error instanceof Anthropic.APIError) console.error(`[ask] AI reading failed (${error.status})`);
    else console.error(`[ask] AI reading failed: ${(error as Error).name}`);
    return undefined;
  }
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

/** Readings already made, so the same question isn't read (or paid for) twice. */
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
