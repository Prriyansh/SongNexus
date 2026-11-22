import { json, route } from "@/lib/accounts/http";
import { listPlaylists } from "@/lib/integrations/library";

// GET /api/library/playlists?source= → { playlists }
export const GET = route(async ({ db, user, url }) => json({ playlists: await listPlaylists(db, user.id, url.searchParams.get("source")) }));
