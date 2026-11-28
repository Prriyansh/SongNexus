import { lookupMusicBrainz, parseDetailsParams } from "@/lib/musicbrainz";
import { answer, CACHE, ok } from "../../respond";

// GET /api/musicbrainz/details?type=artist|recording&id=<MusicBrainz id>
// One artist or recording in full (genres, discography, rating, links). A comparison asks for two,
// so it costs at most two upstream calls, both cached.
export async function GET(request: Request) {
  return answer("musicbrainz", "loading details", async () => {
    const params = parseDetailsParams(new URL(request.url).searchParams);
    return ok({ details: await lookupMusicBrainz(params) }, CACHE.tenMinutes);
  });
}
