import { artistNeighborhood } from "@/lib/artist-neighborhood";
import { parseDetailsParams } from "@/lib/musicbrainz";
import { answer, CACHE, ok } from "../../respond";

// Several MusicBrainz lookups in turn, so allow time when nothing is cached.
export const maxDuration = 60;

// GET /api/musicbrainz/neighborhood?id=<MusicBrainz artist id>
// The artists around one artist, for the Comparison mode's zoom-in. A partial answer (some
// lookups failed) isn't kept, so asking again can complete it.
export async function GET(request: Request) {
  return answer("neighborhood", "discovering this artist’s neighborhood", async () => {
    const params = new URL(request.url).searchParams;
    params.set("type", "artist");
    const neighborhood = await artistNeighborhood(parseDetailsParams(params).id);
    return ok({ neighborhood }, neighborhood.failed.length ? CACHE.never : CACHE.fiveMinutes);
  });
}
