// A stand-in for the network in lib tests: each request is answered by a function of its URL.
import { vi } from "vitest";

/**
 * What a route answers: a JSON body (200), a `Response` for anything else, an `Error` to fail
 * the request as if offline, or `undefined` for a 404.
 */
export type Reply = unknown;

export function fakeWeb(route: (url: URL, init?: RequestInit) => Reply | Promise<Reply>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const reply = await route(new URL(String(input)), init);
    if (reply instanceof Error) throw reply;
    if (reply instanceof Response) return reply;
    if (reply === undefined) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    return new Response(JSON.stringify(reply), { status: 200 });
  });
}

/** A reply with this status and an empty body. */
export const status = (code: number) => new Response("{}", { status: code });

/** A 200 whose body isn't JSON. */
export const garbled = () => new Response("<html>", { status: 200 });

/** Options that make every source answer at once: no cache, throttle or backoff. */
export const quick = { useCache: false, throttleMs: 0, retryBaseMs: 0 } as const;

/** The URLs a fake was asked for, as strings. */
export const asked = (fetchImpl: ReturnType<typeof fakeWeb>) => fetchImpl.mock.calls.map(([url]) => String(url));
