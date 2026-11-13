import { ApiProblem, json, route } from "@/lib/accounts/http";
import { appleDeveloperToken } from "@/lib/integrations/providers/apple-music";
import { adapter, connectable } from "@/lib/integrations/registry";

// GET /api/integrations/apple-music/token → { developerToken } for MusicKit JS, to signed-in users
// only. It identifies this app to Apple, not a person, and expires within 12 hours. No other
// provider has a browser-side token.
export const GET = route<{ provider: string }>(async ({ params, env }) => {
  if (params.provider !== "apple-music") throw new ApiProblem("This service doesn’t use a browser token.", 404);
  if (!connectable(adapter("apple-music"), env)) throw new ApiProblem("Apple Music isn’t set up on this server.", 503, { unavailable: true });
  return json({ developerToken: appleDeveloperToken(env) });
});
