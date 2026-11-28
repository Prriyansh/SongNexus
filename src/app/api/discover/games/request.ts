// What the games' routes share: reading the request and refusing what doesn't add up.
import { dayNumber, LAUNCH_DAY } from "@/discover/lib/days";

export const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export const refuse = (status: number, error: string) => Response.json({ error }, { status, ...NO_STORE });

/** A request's JSON body as an object, or null. */
export async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A games day: a whole number from launch day up to today. */
export function dayOf(value: unknown, now = Date.now()): number | null {
  const day = Number(value);
  return Number.isInteger(day) && day >= LAUNCH_DAY && day <= dayNumber(now) ? day : null;
}
