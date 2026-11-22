import { NextResponse } from "next/server";
import { ApiProblem, json, NO_STORE, readCookie, readJson, route, sessionCookie, sessionCookieName } from "@/lib/accounts/http";
import { consents, deleteUser, sessionUser, verifyUserPassword } from "@/lib/accounts/users";
import { databaseConfigured, getDb } from "@/lib/db";
import { disconnect, listConnections } from "@/lib/integrations/connections";
import { adapter } from "@/lib/integrations/registry";

const SIGNED_OUT = { user: null, consents: [] };

// GET /api/auth/me → { available, user, consents }. `available: false` means this server has no
// database for accounts, which the UI explains instead of offering a sign-in that can't work.
export async function GET(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ available: false, ...SIGNED_OUT }, { headers: NO_STORE });
  try {
    const db = await getDb();
    const user = await sessionUser(db, readCookie(request, sessionCookieName()));
    return NextResponse.json({ available: true, user, consents: user ? await consents(db, user.id) : [] }, { headers: NO_STORE });
  } catch (error) {
    console.error("[auth] me failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ available: false, ...SIGNED_OUT }, { headers: NO_STORE });
  }
}

// DELETE /api/auth/me { password } → deletes the account and everything stored for it.
export const DELETE = route(async ({ request, db, user, env }) => {
  const body = await readJson(request);
  if (typeof body.password !== "string") throw new ApiProblem("Enter your password to delete your account.", 400);
  await verifyUserPassword(db, user.id, body.password);
  // Revoke at each provider that supports it while the tokens still exist.
  for (const connection of await listConnections(db, user.id)) {
    if (adapter(connection.provider).disconnect) await disconnect(db, user.id, connection.id).catch(() => {});
  }
  await deleteUser(db, user.id);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(null, env) });
});
