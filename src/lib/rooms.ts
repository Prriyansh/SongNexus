// Short codes for comparing playlists: one person opens a room, a friend joins with its code, and
// both can load the two playlists. Rooms expire after a week. Stored in Redis (Upstash or Vercel KV)
// when configured; in memory for local development, where one process serves every request.

import { randomInt } from "node:crypto";
import type { PlaylistSong } from "./types";

const TTL_SECONDS = 7 * 24 * 60 * 60;
/** No 0/O, 1/I/L: these get read aloud and typed by hand. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_CREATE_TRIES = 5;

export type RoomMember = { name: string; songs: PlaylistSong[] };
export type Room = { host: RoomMember; guest: RoomMember | null };

export type RoomStore = {
  /** Sets the value only if the key is empty. False if it was taken. */
  setNew: (key: string, value: string, ttlSeconds: number) => Promise<boolean>;
  get: (key: string) => Promise<string | null>;
};

export const isRoomCode = (code: string) => new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(code);
export const normalizeCode = (input: string) => input.trim().toUpperCase().replace(/[\s-]/g, "");

export function newCode(pick: (max: number) => number = randomInt): string {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[pick(ALPHABET.length)]).join("");
}

export function memoryStore(now: () => number = Date.now): RoomStore {
  const data = new Map<string, { value: string; expires: number }>();
  const live = (key: string) => {
    const entry = data.get(key);
    if (entry && entry.expires <= now()) { data.delete(key); return undefined; }
    return entry;
  };
  return {
    setNew: async (key, value, ttl) => {
      if (live(key)) return false;
      data.set(key, { value, expires: now() + ttl * 1000 });
      return true;
    },
    get: async (key) => live(key)?.value ?? null,
  };
}

export function redisStore(url: string, token: string, fetchImpl: typeof fetch = fetch): RoomStore {
  const command = async <T>(args: (string | number)[]): Promise<T> => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Room storage returned an error (${response.status}).`);
    return ((await response.json()) as { result: T }).result;
  };
  return {
    setNew: async (key, value, ttl) => (await command<string | null>(["SET", key, value, "EX", ttl, "NX"])) === "OK",
    get: (key) => command<string | null>(["GET", key]),
  };
}

// On globalThis so every route shares one in development, and it survives hot reloads.
const shared = globalThis as { __songNexusRooms?: RoomStore };

/** Null in production without Redis: memory there would lose rooms between server instances. */
export function roomStore(env: Record<string, string | undefined> = process.env): RoomStore | null {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStore(url, token);
  if (env.NODE_ENV === "production") return null;
  return (shared.__songNexusRooms ??= memoryStore());
}

const hostKey = (code: string) => `room:${code}:host`;
const guestKey = (code: string) => `room:${code}:guest`;

export async function createRoom(store: RoomStore, host: RoomMember, makeCode: () => string = newCode): Promise<string> {
  for (let attempt = 0; attempt < MAX_CREATE_TRIES; attempt++) {
    const code = makeCode();
    if (await store.setNew(hostKey(code), JSON.stringify(host), TTL_SECONDS)) return code;
  }
  throw new Error("Could not find a free room code.");
}

export async function readRoom(store: RoomStore, code: string): Promise<Room | null> {
  const host = await store.get(hostKey(code));
  if (!host) return null;
  const guest = await store.get(guestKey(code));
  return { host: JSON.parse(host) as RoomMember, guest: guest ? (JSON.parse(guest) as RoomMember) : null };
}

/** "full" once someone else has joined: a room is for two people, and a guest can't be replaced. */
export async function joinRoom(store: RoomStore, code: string, guest: RoomMember): Promise<Room | "missing" | "full"> {
  const room = await readRoom(store, code);
  if (!room) return "missing";
  if (!(await store.setNew(guestKey(code), JSON.stringify(guest), TTL_SECONDS))) return "full";
  return { ...room, guest };
}
