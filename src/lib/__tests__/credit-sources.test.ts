import { describe, expect, it, vi } from "vitest";
import { sourceJson, USER_AGENT } from "../credit-sources";
import { UpstreamError } from "../musicbrainz";

const answering = (response: Partial<Response> | Error) =>
  vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
    void args;
    if (response instanceof Error) throw response;
    return { ok: true, status: 200, json: async () => ({ ok: 1 }), ...response } as Response;
  });

const sentHeaders = (fetchImpl: ReturnType<typeof answering>) =>
  new Headers(fetchImpl.mock.lastCall![1]!.headers);

describe("asking another source for JSON", () => {
  it("names us, asks for JSON, and stops waiting after a while", async () => {
    const fetchImpl = answering({});
    expect(await sourceJson("Test", "https://x/y", {}, { fetchImpl })).toEqual({ ok: 1 });
    const headers = sentHeaders(fetchImpl);
    expect(headers.get("User-Agent")).toBe(USER_AGENT);
    expect(headers.get("Accept")).toBe("application/json");
    expect(fetchImpl.mock.lastCall![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the caller's headers in any form, letting them replace ours", async () => {
    for (const given of [
      { Authorization: "Bearer t", Accept: "text/plain" },
      new Headers({ Authorization: "Bearer t", Accept: "text/plain" }),
      [
        ["Authorization", "Bearer t"],
        ["Accept", "text/plain"],
      ] as [string, string][],
    ]) {
      const fetchImpl = answering({});
      await sourceJson("Test", "https://x/y", { headers: given, method: "POST" }, { fetchImpl });
      const headers = sentHeaders(fetchImpl);
      expect(headers.get("Authorization")).toBe("Bearer t");
      expect(headers.get("Accept")).toBe("text/plain");
      expect(headers.get("User-Agent")).toBe(USER_AGENT);
      expect(fetchImpl.mock.lastCall![1]!.method).toBe("POST");
    }
  });

  it("names the source in every failure, and says which are worth retrying", async () => {
    const failure = async (response: Partial<Response> | Error) => {
      const error = await sourceJson(
        "Genius",
        "https://x",
        {},
        { fetchImpl: answering(response) },
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      const { message, status, retryable } = error as UpstreamError;
      expect(message).toContain("Genius");
      expect(status).toBe(502);
      return retryable;
    };
    expect(await failure(new TypeError("offline"))).toBe(true);
    expect(await failure({ ok: false, status: 429 })).toBe(true);
    expect(await failure({ ok: false, status: 503 })).toBe(true);
    expect(await failure({ ok: false, status: 404 })).toBe(false);
    expect(await failure({ json: () => Promise.reject(new SyntaxError("bad")) })).toBe(false);
  });
});
