// Shared storage for what people leave behind: leaderboards now, accounts later. Redis (Upstash or
// Vercel KV, over its REST API) when configured; in memory for local development, where one process
// serves every request. Server only.

export type Store = {
  /** Sets a value only if the key is empty. False if it was taken. */
  setNew: (key: string, value: string, ttlSeconds: number) => Promise<boolean>;
  set: (key: string, value: string, ttlSeconds: number) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  del: (key: string) => Promise<void>;
  /** Adds a member to a ranked list (lower scores first) unless it is there. False if it was. */
  rankNew: (key: string, member: string, score: number, ttlSeconds: number) => Promise<boolean>;
  /** Takes a member out of a ranked list. */
  unrank: (key: string, member: string) => Promise<void>;
  /** The first `count` members, with their scores. */
  top: (key: string, count: number) => Promise<[member: string, score: number][]>;
  size: (key: string) => Promise<number>;
  /** How many members are ahead of this one, or null if it isn't there. */
  place: (key: string, member: string) => Promise<number | null>;
};

type Entry = { value: string | Map<string, number>; expires: number };

export function memoryStore(now: () => number = Date.now): Store {
  const data = new Map<string, Entry>();
  const live = (key: string) => {
    const entry = data.get(key);
    if (entry && entry.expires <= now()) {
      data.delete(key);
      return undefined;
    }
    return entry;
  };
  const ranked = (key: string) => {
    const value = live(key)?.value;
    return [...((value as Map<string, number> | undefined) ?? new Map<string, number>())].sort(
      // Ties in member order, as Redis keeps them (members here are plain IDs).
      ([x, p], [y, q]) => p - q || x.localeCompare(y),
    );
  };
  return {
    setNew: async (key, value, ttl) => {
      if (live(key)) return false;
      data.set(key, { value, expires: now() + ttl * 1000 });
      return true;
    },
    set: async (key, value, ttl) => void data.set(key, { value, expires: now() + ttl * 1000 }),
    get: async (key) => (live(key)?.value as string | undefined) ?? null,
    del: async (key) => void data.delete(key),
    rankNew: async (key, member, score, ttl) => {
      const list = (live(key)?.value as Map<string, number> | undefined) ?? new Map<string, number>();
      if (list.has(member)) return false;
      data.set(key, { value: list.set(member, score), expires: now() + ttl * 1000 });
      return true;
    },
    unrank: async (key, member) => void (live(key)?.value as Map<string, number> | undefined)?.delete(member),
    top: async (key, count) => ranked(key).slice(0, count),
    size: async (key) => ranked(key).length,
    place: async (key, member) => {
      const at = ranked(key).findIndex(([m]) => m === member);
      return at < 0 ? null : at;
    },
  };
}

export function redisStore(url: string, token: string, fetchImpl: typeof fetch = fetch): Store {
  const command = async <T>(args: (string | number)[]): Promise<T> => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Storage returned an error (${response.status}).`);
    return ((await response.json()) as { result: T }).result;
  };
  return {
    setNew: async (key, value, ttl) => (await command<string | null>(["SET", key, value, "EX", ttl, "NX"])) === "OK",
    set: async (key, value, ttl) => void (await command(["SET", key, value, "EX", ttl])),
    get: (key) => command<string | null>(["GET", key]),
    del: async (key) => void (await command(["DEL", key])),
    rankNew: async (key, member, score, ttl) => {
      const added = await command<number>(["ZADD", key, "NX", score, member]);
      await command(["EXPIRE", key, ttl]);
      return added === 1;
    },
    unrank: async (key, member) => void (await command(["ZREM", key, member])),
    top: async (key, count) => {
      const flat = await command<string[]>(["ZRANGE", key, 0, count - 1, "WITHSCORES"]);
      return Array.from({ length: flat.length / 2 }, (_, i) => [flat[2 * i], Number(flat[2 * i + 1])]);
    },
    size: (key) => command<number>(["ZCARD", key]),
    place: (key, member) => command<number | null>(["ZRANK", key, member]),
  };
}

// On globalThis so every route shares one in development, and it survives hot reloads.
const shared = globalThis as { __songNexusStore?: Store };

/** Null in production without Redis: memory there would lose everything between server instances. */
export function store(env: Record<string, string | undefined> = process.env): Store | null {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStore(url, token);
  if (env.NODE_ENV === "production") return null;
  return (shared.__songNexusStore ??= memoryStore());
}
