import { ApiProblem, json, readJson, route } from "@/lib/accounts/http";
import { CONSENTS, consents, setConsent } from "@/lib/accounts/users";
import type { Consent } from "@/lib/accounts/users";

// PUT /api/auth/consents { kind: "combine_sources", granted } → { consents }
export const PUT = route(async ({ request, db, user }) => {
  const body = await readJson(request);
  if (typeof body.kind !== "string" || !(CONSENTS as readonly string[]).includes(body.kind) || typeof body.granted !== "boolean") throw new ApiProblem("Unknown setting.", 400);
  await setConsent(db, user.id, body.kind as Consent, body.granted);
  return json({ consents: await consents(db, user.id) });
});
