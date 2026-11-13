import { ApiProblem, json, route } from "@/lib/accounts/http";
import { rateLimit } from "@/lib/accounts/users";
import { syncSoon } from "@/lib/integrations/background";
import { ownedConnection } from "@/lib/integrations/connections";
import { enqueue, jobView } from "@/lib/integrations/jobs";

export const maxDuration = 60;

// POST /api/integrations/connections/:id/sync → 202 { job, created }. Asking while a sync is
// already queued or running returns that job instead of starting another.
export const POST = route<{ id: string }>(async ({ db, user, params }) => {
  const connection = await ownedConnection(db, user.id, params.id);
  if (connection.status === "reauth_required") throw new ApiProblem("Reconnect this account before syncing.", 409, { reauthRequired: true });
  await rateLimit(db, `sync:${connection.id}`, 6, 300);
  const { job, created } = await enqueue(db, { id: connection.id, userId: user.id }, "manual");
  syncSoon(db, user.id);
  return json({ job: jobView(job), created }, 202);
});
