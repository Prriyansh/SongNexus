import { artistInsights } from "@/lib/artist-insights";
import { parseCollaboratorParams } from "@/lib/musicbrainz";
import { answer, CACHE, ok } from "../respond";

// GET /api/artist-insights?a=&b=
// Bio, awards, labels, audience and shared facts for two artists, each from a named source.
export async function GET(request: Request) {
  return answer("insights", "loading artist facts", async () => {
    const { a, b } = parseCollaboratorParams(new URL(request.url).searchParams);
    const insights = await artistInsights(a, b);
    const settled = insights.sources.every((s) => s.status !== "failed");
    return ok({ insights }, settled ? CACHE.hour : CACHE.never);
  });
}
