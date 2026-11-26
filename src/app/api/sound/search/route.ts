import { searchSound } from "@/lib/sound";
import { answer, CACHE, fail, ok } from "../../respond";

// GET /api/sound/search?q=&limit=
// Songs in the sound dataset matching a title or artist. Answers { status: "unavailable" } when
// the song_compare service isn't running, so the picker can fall back to MusicBrainz search.
export function GET(request: Request) {
  return answer("sound-search", "searching the song library", async () => {
    const params = new URL(request.url).searchParams;
    const q = (params.get("q") ?? "").trim();
    if (q.length < 2 || q.length > 200) return fail(400, 'Query param "q" must be 2–200 characters.');
    const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "10", 10) || 10, 1), 25);
    const result = await searchSound(q, limit);
    return ok(result, result.status === "ok" ? CACHE.hour : CACHE.never);
  });
}
