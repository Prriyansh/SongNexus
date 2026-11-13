import { ApiProblem, appOrigin, json, readJson, route } from "@/lib/accounts/http";
import { rateLimit } from "@/lib/accounts/users";
import { syncSoon } from "@/lib/integrations/background";
import { beginAuthorization, connectWithToken } from "@/lib/integrations/connections";
import { adapter } from "@/lib/integrations/registry";
import { isProviderId } from "@/lib/integrations/types";

export const maxDuration = 60;

// POST /api/integrations/:provider/connect
//   OAuth providers  → { authorizeUrl }: send the browser there; it comes back to …/callback.
//   Token providers  → body { token } (ListenBrainz) or { musicUserToken } (Apple Music) → 201 { connection }.
export const POST = route<{ provider: string }>(async ({ request, db, user, params, env }) => {
  if (!isProviderId(params.provider)) throw new ApiProblem("Unknown music service.", 404);
  await rateLimit(db, `connect:${user.id}`, 20, 600);
  if (adapter(params.provider).auth === "oauth") return json({ authorizeUrl: await beginAuthorization(db, user.id, params.provider, appOrigin(request, env)) });
  const connection = await connectWithToken(db, user.id, params.provider, await readJson(request));
  syncSoon(db, user.id);
  return json({ connection }, 201);
});
