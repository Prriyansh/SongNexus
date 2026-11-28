import { moreCredits } from "@/lib/more-credits";
import { parseCollaboratorParams } from "@/lib/musicbrainz";
import { answer, CACHE, ok } from "../respond";

// Scans each artist's work on Genius and Discogs, so allow time on serverless hosts.
export const maxDuration = 60;

// GET /api/credits?a=&b=
// Collaborators of two artists according to Genius and Discogs. One source failing or lacking a
// token shows up in `sources`; it isn't an error for the request.
export async function GET(request: Request) {
  return answer("credits", "looking for more credits", async () => {
    const { a, b } = parseCollaboratorParams(new URL(request.url).searchParams);
    const credits = await moreCredits(a, b);
    const settled = credits.sources.every((s) => s.status !== "partial" && s.status !== "failed");
    return ok({ credits }, settled ? CACHE.hour : CACHE.never);
  });
}
