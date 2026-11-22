import { json, route } from "@/lib/accounts/http";
import { discoveryPlaylist } from "@/lib/integrations/library";

// GET /api/library/discovery → { songs: [{ title, artist }] } from the user's open sources, for the
// Connection Web. 403 with consentRequired until they've turned on combining sources.
export const GET = route(async ({ db, user }) => json({ songs: await discoveryPlaylist(db, user.id) }));
