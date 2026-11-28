// What the account routes share: the settings they need, and their answers.
import { authConfig, personOf, sameOrigin, type Person } from "@/discover/lib/auth";
import { store, type Store } from "@/discover/lib/store";

const NO_STORE = { "Cache-Control": "no-store" };

export const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } });

export const refuse = (status: number, error: string) => reply({ error }, status);

type Ready = { store: Store; clientId: string; secret: string; person: Person | null };

/**
 * Everything an account route needs, or the answer to send instead: 503 when sign-in or storage
 * isn't set up, 403 for a change asked by another site.
 */
export function ready(request: Request, changes: boolean): Ready | Response {
  const config = authConfig();
  const kept = store();
  if (!config || !kept) return refuse(503, "Accounts aren’t set up on this server.");
  if (changes && !sameOrigin(request)) return refuse(403, "That has to come from Song Nexus itself.");
  return { store: kept, ...config, person: personOf(request) };
}
