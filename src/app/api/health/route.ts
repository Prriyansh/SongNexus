import { connection } from "next/server";
import { aiEnabled } from "@/discover/lib/ai-ask";
import { authConfig } from "@/discover/lib/auth";
import { graph } from "@/discover/lib/server";
import { store } from "@/discover/lib/store";

type Env = Record<string, string | undefined>;

/** Where shared data lives: Redis, this server's memory, or nowhere. */
export function storageOf(env: Env): "redis" | "memory" | "none" {
  if ((env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL) && (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN))
    return "redis";
  return store(env) ? "memory" : "none";
}

/** What a deployment has switched on, and what it is set up wrong for. Never a secret's value. */
export function healthOf(env: Env) {
  const production = env.NODE_ENV === "production";
  const storage = storageOf(env);
  const accounts = authConfig(env) !== null;
  const problems: string[] = [];
  if (env.GOOGLE_CLIENT_ID?.trim() && !accounts)
    problems.push("GOOGLE_CLIENT_ID is set, but SESSION_SECRET is missing or shorter than 32 characters, so sign-in is off.");
  if (production && storage === "none")
    problems.push("No Redis: leaderboards, accounts and Around You are off, and Friends falls back to long links.");
  if (production && storage === "memory")
    problems.push("Memory storage in production: each server instance has its own, and all of it goes on a restart.");
  const c = graph().catalog;
  return {
    ok: problems.length === 0,
    version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: env.VERCEL_ENV ?? env.NODE_ENV ?? null,
    catalog: { artists: c.artists.length, songs: c.songs.length },
    storage,
    features: {
      leaderboards: storage !== "none",
      accounts: accounts && storage !== "none",
      aroundYou: storage !== "none",
      aiSearch: aiEnabled(env),
      lastFm: Boolean(env.LASTFM_API_KEY?.trim()),
      genius: Boolean(env.GENIUS_ACCESS_TOKEN?.trim()),
      discogsToken: Boolean(env.DISCOGS_TOKEN?.trim()),
      soundService: Boolean(env.SONG_COMPARE_URL?.trim()) || !production,
    },
    problems,
  };
}

// What this deployment can do, for checking a release: which features are on, and what's set up
// wrong. Answers 200 either way; `ok` says whether there are problems.
export async function GET() {
  await connection();
  return Response.json(healthOf(process.env), { headers: { "Cache-Control": "no-store" } });
}
