import { json, readCookie, route, sessionCookie, sessionCookieName } from "@/lib/accounts/http";
import { endSession } from "@/lib/accounts/users";

// POST /api/auth/logout → ends this session only; other devices stay signed in.
export const POST = route(async ({ request, db, env }) => {
  await endSession(db, readCookie(request, sessionCookieName(env)));
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(null, env) });
}, { auth: false });
