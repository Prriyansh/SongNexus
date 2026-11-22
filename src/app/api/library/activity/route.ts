import { json, route } from "@/lib/accounts/http";
import { listPlays } from "@/lib/integrations/library";

// GET /api/library/activity?source=&before=&limit= → { plays, next }. Newest first; pass `next` as `before` for older plays.
export const GET = route(async ({ db, user, url }) => {
  const q = url.searchParams;
  return json(await listPlays(db, user.id, { source: q.get("source"), before: q.get("before"), limit: q.get("limit") }));
});
