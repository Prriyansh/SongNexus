import { ApiProblem, json, route } from "@/lib/accounts/http";
import { disconnect, listConnections, ownedConnection } from "@/lib/integrations/connections";

type Params = { id: string };

// GET /api/integrations/connections/:id → { connection }
export const GET = route<Params>(async ({ db, user, params }) => {
  await ownedConnection(db, user.id, params.id);
  const connection = (await listConnections(db, user.id)).find((c) => c.id === params.id);
  if (!connection) throw new ApiProblem("That connection wasn’t found.", 404);
  return json({ connection });
});

// DELETE /api/integrations/connections/:id → revokes access where the provider allows it, then
// deletes the connection with its credentials and everything synced through it.
export const DELETE = route<Params>(async ({ db, user, params }) => {
  await disconnect(db, user.id, params.id);
  return json({ ok: true });
});
