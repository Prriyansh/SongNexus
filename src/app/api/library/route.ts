import { json, route } from "@/lib/accounts/http";
import { listLibrary } from "@/lib/integrations/library";

// GET /api/library?source=&relation=&kind=&q=&limit=&offset= → { items, total }
// `source` is a provider id ("lastfm"), an import ("import:shazam-library") or "combined".
export const GET = route(async ({ db, user, url }) => {
  const q = url.searchParams;
  return json(await listLibrary(db, user.id, { source: q.get("source"), relation: q.get("relation"), kind: q.get("kind"), q: q.get("q"), limit: q.get("limit"), offset: q.get("offset") }));
});
