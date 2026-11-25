// How every API route answers: JSON with a caching rule, and the same mapping of errors to
// statuses. Not a route itself (no route.ts), so Next never serves it.
import { NextResponse } from "next/server";
import { UpstreamError, ValidationError } from "@/lib/musicbrainz";

/** How long an answer may be reused by browsers and CDNs. */
export const CACHE = {
  minute: "public, max-age=60",
  fiveMinutes: "public, max-age=300",
  tenMinutes: "public, max-age=600",
  hour: "public, max-age=3600",
  /** For answers that are personal, incomplete or about to change. */
  never: "no-store",
} as const;

export type Cache = (typeof CACHE)[keyof typeof CACHE];

export function ok(body: unknown, cache: Cache): NextResponse {
  return NextResponse.json(body, { headers: { "Cache-Control": cache } });
}

export function fail(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

/**
 * Runs a route's work and turns what it throws into an answer: bad input is 400, a source that
 * failed keeps its status and says whether trying again may help, and anything else is a 500 that
 * says `what` went wrong without its cause. Every failure but bad input is logged under `name`.
 */
export async function answer(
  name: string,
  what: string,
  work: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ValidationError) return fail(400, error.message);
    if (error instanceof UpstreamError) {
      console.error(`[${name}] upstream failure (${error.status}): ${error.message}`);
      return fail(error.status, error.message, { retryable: error.retryable });
    }
    console.error(`[${name}] unexpected failure:`, error);
    return fail(500, `Something went wrong while ${what}.`);
  }
}

/** A request's JSON body, or null when it has none or it isn't JSON. */
export const bodyOf = (request: Request): Promise<unknown> => request.json().catch(() => null);
