import { clientKey, json, readJson, route, sessionCookie } from "@/lib/accounts/http";
import { createSession, register } from "@/lib/accounts/users";

// POST /api/auth/register { username, password } → { user }, and a session cookie.
export const POST = route(async ({ request, db, env }) => {
  const user = await register(db, await readJson(request), clientKey(request));
  return json({ user }, 201, { "Set-Cookie": sessionCookie(await createSession(db, user.id), env) });
}, { auth: false });
