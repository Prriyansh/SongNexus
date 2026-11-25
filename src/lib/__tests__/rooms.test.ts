import { describe, expect, it, vi } from "vitest";
import { createRoom, isRoomCode, joinRoom, memoryStore, newCode, normalizeCode, readRoom, redisStore, roomStore } from "../rooms";

const host = { name: "Alka", songs: [{ title: "vampire", artist: "Olivia Rodrigo" }] };
const guest = { name: "Sam", songs: [{ title: "HUMBLE.", artist: "Kendrick Lamar" }] };

describe("codes", () => {
  it("are 6 characters, without ones that are easy to misread", () => {
    for (let i = 0; i < 200; i++) {
      const code = newCode();
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(code).not.toMatch(/[01OIL]/);
      expect(isRoomCode(code)).toBe(true);
    }
  });
  it("accept typing as people type", () => {
    expect(normalizeCode(" abc-234 ")).toBe("ABC234");
    expect(isRoomCode("ABC23")).toBe(false);
    expect(isRoomCode("ABC2O4")).toBe(false);
  });
});

describe("rooms", () => {
  it("hold both playlists once a friend joins", async () => {
    const store = memoryStore();
    const code = await createRoom(store, host);
    expect(await readRoom(store, code)).toEqual({ host, guest: null });
    expect(await joinRoom(store, code, guest)).toEqual({ host, guest });
    expect(await readRoom(store, code)).toEqual({ host, guest });
  });
  it("take one friend, and a second can't replace them", async () => {
    const store = memoryStore();
    const code = await createRoom(store, host);
    await joinRoom(store, code, guest);
    expect(await joinRoom(store, code, { name: "Third", songs: guest.songs })).toBe("full");
    expect((await readRoom(store, code))?.guest?.name).toBe("Sam");
  });
  it("can't be joined if they don't exist", async () => {
    expect(await joinRoom(memoryStore(), "ABC234", guest)).toBe("missing");
  });
  it("expire after a week", async () => {
    let time = 0;
    const store = memoryStore(() => time);
    const code = await createRoom(store, host);
    time = 6 * 24 * 3600 * 1000;
    expect(await readRoom(store, code)).not.toBeNull();
    time = 8 * 24 * 3600 * 1000;
    expect(await readRoom(store, code)).toBeNull();
  });
  it("pick another code if one is taken", async () => {
    const store = memoryStore();
    await createRoom(store, host, () => "AAAAAA");
    const codes = ["AAAAAA", "BBBBBB"];
    expect(await createRoom(store, guest, () => codes.shift()!)).toBe("BBBBBB");
    expect((await readRoom(store, "AAAAAA"))?.host.name).toBe("Alka");
  });
});

describe("storage", () => {
  it("speaks Redis, only setting new keys and with an expiry", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ result: "OK" }) }) as Response);
    const store = redisStore("https://redis.example", "tok", fetchImpl as unknown as typeof fetch);
    expect(await store.setNew("k", "v", 60)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://redis.example");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(JSON.parse(String(init.body))).toEqual(["SET", "k", "v", "EX", 60, "NX"]);
  });
  it("reports a taken key", async () => {
    const store = redisStore("https://r", "t", (async () => ({ ok: true, json: async () => ({ result: null }) })) as unknown as typeof fetch);
    expect(await store.setNew("k", "v", 60)).toBe(false);
  });
  it("uses memory in development, Redis when configured, and nothing in production without it", () => {
    expect(roomStore({ NODE_ENV: "development" })).not.toBeNull();
    expect(roomStore({ NODE_ENV: "production" })).toBeNull();
    expect(roomStore({ NODE_ENV: "production", KV_REST_API_URL: "https://r", KV_REST_API_TOKEN: "t" })).not.toBeNull();
    expect(roomStore({ NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "https://r", UPSTASH_REDIS_REST_TOKEN: "t" })).not.toBeNull();
  });
});
