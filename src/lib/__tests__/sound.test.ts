import { describe, expect, it, vi } from "vitest";
import { compareSound, searchSound, songCompareUrl } from "../sound";
import type { SoundComparison } from "../sound";

const BASE = "http://songs.test";
const brief = (id: string, title: string) => ({ id, title, artists: ["X"], album: null, genre: "pop", has_lyrics: true });
const comparison = { overall: 0.56, reasons: ["Both lean toward love."] } as unknown as SoundComparison;

/** A fake song_compare service: knows "drivers license" and "Blank Space". */
function service(overrides: Record<string, Response | Error> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const key = url.pathname + (url.pathname === "/api/match" ? `:${url.searchParams.get("title")}` : "");
    const override = overrides[key];
    if (override instanceof Error) throw override;
    if (override) return override;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname === "/api/match") {
      const known: Record<string, string> = { "drivers license": "sp1", "Blank Space": "sp2", "drivers license (Remastered)": "sp1" };
      const id = known[url.searchParams.get("title") ?? ""];
      return id ? json({ track: brief(id, url.searchParams.get("title")!) }) : json({ error: "Not in the dataset." }, 404);
    }
    if (url.pathname === "/api/compare") return json(comparison);
    if (url.pathname.startsWith("/api/similar/")) return json({ results: [{ ...brief("sp9", "Similar"), score: 0.9, shares_artist: false }] });
    return json({ error: "unknown" }, 404);
  });
}

const A = { title: "drivers license", artist: "Olivia Rodrigo" };
const B = { title: "Blank Space", artist: "Taylor Swift" };

describe("compareSound", () => {
  it("matches both songs by name, then compares them and finds similar songs", async () => {
    const fetchImpl = service();
    const result = await compareSound(A, B, { baseUrl: BASE, fetchImpl });
    expect(result).toEqual({ status: "ok", comparison, similar: { a: [expect.objectContaining({ id: "sp9" })], b: [expect.objectContaining({ id: "sp9" })] } });
    const urls = fetchImpl.mock.calls.map(([u]) => String(u));
    expect(urls).toContain(`${BASE}/api/match?title=drivers%20license&artist=Olivia%20Rodrigo`);
    expect(urls).toContain(`${BASE}/api/compare?a=sp1&b=sp2`);
    expect(urls).toContain(`${BASE}/api/similar/sp1?k=4`);
  });

  it("reports which songs the dataset doesn't have", async () => {
    const result = await compareSound({ title: "vampire", artist: "Olivia Rodrigo" }, B, { baseUrl: BASE, fetchImpl: service() });
    expect(result).toEqual({ status: "not-found", missing: ["a"] });
  });

  it("notices when both names are the same dataset track", async () => {
    const result = await compareSound(A, { ...A, title: "drivers license (Remastered)" }, { baseUrl: BASE, fetchImpl: service() });
    expect(result).toEqual({ status: "same-track" });
  });

  it("is unavailable when the service isn't configured, is down, or errors", async () => {
    expect(await compareSound(A, B, { baseUrl: null, fetchImpl: service() })).toEqual({ status: "unavailable" });
    const down = service({ "/api/match:drivers license": new TypeError("fetch failed") });
    expect(await compareSound(A, B, { baseUrl: BASE, fetchImpl: down })).toEqual({ status: "unavailable" });
    const broken = service({ "/api/compare": new Response("oops", { status: 503 }) });
    expect(await compareSound(A, B, { baseUrl: BASE, fetchImpl: broken })).toEqual({ status: "unavailable" });
  });

  it("gives up on a service that doesn't answer in time", async () => {
    const slow = vi.fn((_: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
    }));
    expect(await compareSound(A, B, { baseUrl: BASE, fetchImpl: slow as unknown as typeof fetch, timeoutMs: 20 })).toEqual({ status: "unavailable" });
  });
});

describe("songCompareUrl", () => {
  it("uses SONG_COMPARE_URL, else the local port in development only", () => {
    expect(songCompareUrl({ SONG_COMPARE_URL: "https://sound.example.com/" })).toBe("https://sound.example.com");
    expect(songCompareUrl({ NODE_ENV: "development" })).toBe("http://localhost:5050");
    expect(songCompareUrl({ NODE_ENV: "production" })).toBeNull();
  });
});

describe("searchSound", () => {
  it("searches the dataset by title or artist", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [brief("sp1", "drivers license")] })));
    expect(await searchSound("drivers", 5, { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ status: "ok", results: [brief("sp1", "drivers license")] });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe(`${BASE}/api/search?q=drivers&limit=5`);
  });

  it("is unavailable without the service, or when it fails", async () => {
    expect(await searchSound("x", 5, { baseUrl: null })).toEqual({ status: "unavailable" });
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await searchSound("xx", 5, { baseUrl: BASE, fetchImpl: down as unknown as typeof fetch })).toEqual({ status: "unavailable" });
    const broken = vi.fn(async () => new Response("no", { status: 503 }));
    expect(await searchSound("xx", 5, { baseUrl: BASE, fetchImpl: broken as unknown as typeof fetch })).toEqual({ status: "unavailable" });
  });
});

