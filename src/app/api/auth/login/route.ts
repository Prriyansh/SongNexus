import { clientKey, json, readJson, route, sessionCookie } from "@/lib/accounts/http";
import { createSession, login } from "@/lib/accounts/users";

// POST /api/auth/login { username, password } → { user }, and a session cookie.
export const POST = route(async ({ request, db, env }) => {
  const user = await login(db, await readJson(request), clientKey(request));
  return json({ user }, 200, { "Set-Cookie": sessionCookie(await createSession(db, user.id), env) });
}, { auth: false });
