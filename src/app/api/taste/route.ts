import { buildTaste, parseTasteRequest } from "@/lib/taste";
import { answer, bodyOf, CACHE, fail, ok } from "../respond";

// Looks up each playlist's main artists, so allow time when nothing is cached.
export const maxDuration = 60;

// POST /api/taste { mine: [{ title, artist }], friend?: [...], friendName? }
// A map from one playlist or two. Playlists are used for this response and not stored.
export async function POST(request: Request) {
  const taste = parseTasteRequest(await bodyOf(request));
  if (!taste)
    return fail(
      400,
      "Send at least one song with both a title and an artist, up to 250 per playlist.",
    );
  return answer("taste", "building this map", async () =>
    ok({ taste: await buildTaste(taste) }, CACHE.never),
  );
}
