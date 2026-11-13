import { json, route } from "@/lib/accounts/http";
import { listConnections } from "@/lib/integrations/connections";

// GET /api/integrations/connections → { connections }: status, granted capabilities, per-resource
// sync state and the current or latest job for each of the signed-in user's connections.
export const GET = route(async ({ db, user }) => json({ connections: await listConnections(db, user.id) }));
