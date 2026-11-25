import { parseSearchParams, searchMusicBrainz } from "@/lib/musicbrainz";
import { answer, CACHE, ok } from "../../respond";

// GET /api/musicbrainz/search?type=artist|recording&q=&limit=
// MusicBrainz through our own server, so the User-Agent, rate limiting and error handling live in
// one place and nothing from upstream leaks to the browser. Identical searches made in quick
// succession are answered from the browser's or CDN's cache.
export async function GET(request: Request) {
  return answer("musicbrainz", "searching MusicBrainz", async () => {
    const params = parseSearchParams(new URL(request.url).searchParams);
    return ok({ results: await searchMusicBrainz(params) }, CACHE.minute);
  });
}
