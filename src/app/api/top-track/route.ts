import { ValidationError } from "@/lib/musicbrainz";
import { findTopTrack } from "@/lib/top-track";
import { answer, CACHE, ok } from "../respond";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 200;

// GET /api/top-track?id=<MusicBrainz artist id>&name=<artist name>
// The artist's most popular song (ranked by Deezer), as a MusicBrainz recording, or null.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return answer("top-track", "finding top tracks", async () => {
    const id = (params.get("id") ?? "").trim();
    const name = (params.get("name") ?? "").trim();
    if (!UUID_RE.test(id) || !name || name.length > MAX_NAME) {
      throw new ValidationError(
        'Query params "id" (MusicBrainz artist UUID) and "name" are required.',
      );
    }
    return ok({ track: await findTopTrack({ id, name }) }, CACHE.hour);
  });
}
