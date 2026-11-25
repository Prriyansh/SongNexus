import { NextResponse } from "next/server";
import { parseCollaboratorParams, UpstreamError, ValidationError } from "@/lib/musicbrainz";
import { moreCredits } from "@/lib/more-credits";

// Scans each artist's work on Genius and Discogs, so allow time on serverless hosts.
export const maxDuration = 60;

// GET /api/credits?a=&b=
// Collaborators of two artists according to Genius and Discogs. One source failing or lacking a
// token shows up in `sources`; it isn't an error for the request.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const { a, b } = parseCollaboratorParams(searchParams);
    const credits = await moreCredits(a, b);
    const settled = credits.sources.every((s) => s.status !== "partial" && s.status !== "failed");
    return NextResponse.json({ credits }, { headers: { "Cache-Control": settled ? "public, max-age=3600" : "no-store" } });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof UpstreamError) return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.status });
    console.error("[credits] unexpected failure:", error);
    return NextResponse.json({ error: "Something went wrong while looking for more credits." }, { status: 500 });
  }
}
