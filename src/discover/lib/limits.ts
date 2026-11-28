// Per-visitor limits on what writes or costs something: each address may do so much an hour, so one
// visitor can't flood a leaderboard, sign in endlessly, or use up a free daily quota. Counted in
// shared storage, or per server instance without it. Server only.
import { store, type Store } from "./store";

export type Limit = { name: string; max: number; seconds: number };

const HOUR = 3600;
export const LIMITS = {
  /** Connect steps and quiz answers. */
  play: { name: "play", max: 600, seconds: HOUR },
  score: { name: "score", max: 30, seconds: HOUR },
  signIn: { name: "sign-in", max: 20, seconds: HOUR },
  sync: { name: "sync", max: 600, seconds: HOUR },
  community: { name: "community", max: 30, seconds: HOUR },
  /** Calls to ListenBrainz, Last.fm or Deezer. */
  listening: { name: "listening", max: 60, seconds: HOUR },
  /** Friend paths and Your Nexus: path searches over the whole graph. */
  nexus: { name: "nexus", max: 300, seconds: HOUR },
  /** Questions read by AI, inside the day's overall limit. */
  ai: { name: "ai", max: 30, seconds: HOUR },
} satisfies Record<string, Limit>;

/** Who is asking: the first address a proxy (Vercel's) forwarded, or "unknown". */
export function visitorOf(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim();
  return forwarded && /^[0-9a-f.:]{2,45}$/i.test(forwarded) ? forwarded : "unknown";
}

const counts = new Map<string, number>();
/** Per-instance counts are dropped wholesale past this many, which only ever forgives. */
const MAX_COUNTS = 10_000;

/** Counts one more for this visitor; true while they're within the limit. */
export async function withinLimit(visitor: string, limit: Limit, kept: Store | null = store(), now = Date.now()): Promise<boolean> {
  const window = Math.floor(now / (limit.seconds * 1000));
  const key = `limit:${limit.name}:${visitor}:${window}`;
  let count: number;
  if (kept) count = await kept.increment(key, limit.seconds);
  else {
    if (counts.size >= MAX_COUNTS) counts.clear();
    count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
  }
  return count <= limit.max;
}

/** The 429 to send a visitor over a limit, or null to go ahead. */
export async function tooMany(request: Request, limit: Limit, kept: Store | null = store(), now = Date.now()): Promise<Response | null> {
  if (await withinLimit(visitorOf(request.headers), limit, kept, now)) return null;
  const windowEnds = (Math.floor(now / (limit.seconds * 1000)) + 1) * limit.seconds * 1000;
  return Response.json(
    { error: "That’s a lot of tries for one hour. Try again a little later." },
    { status: 429, headers: { "Retry-After": String(Math.ceil((windowEnds - now) / 1000)), "Cache-Control": "no-store" } },
  );
}

/** Forgets per-instance counts. For tests. */
export const forgetCounts = () => counts.clear();
