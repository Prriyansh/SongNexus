import { json, route } from "@/lib/accounts/http";
import { playlistTracks } from "@/lib/integrations/library";

// GET /api/library/playlists/:id?limit=&offset= → { playlist, tracks, total }
export const GET = route<{ id: string }>(async ({ db, user, url, params }) =>
  json(await playlistTracks(db, user.id, params.id, { limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") })));
