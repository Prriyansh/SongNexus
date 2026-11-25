import { NextResponse } from "next/server";
import { parseCollaboratorParams, UpstreamError, ValidationError } from "@/lib/musicbrainz";
import { artistInsights } from "@/lib/artist-insights";

// GET /api/artist-insights?a=&b=
// Bio, awards, labels, audience and shared facts for two artists, each from a named source.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const { a, b } = parseCollaboratorParams(searchParams);
    const insights = await artistInsights(a, b);
    const settled = insights.sources.every((s) => s.status !== "failed");
    return NextResponse.json({ insights }, { headers: { "Cache-Control": settled ? "public, max-age=3600" : "no-store" } });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof UpstreamError) return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.status });
    console.error("[insights] unexpected failure:", error);
    return NextResponse.json({ error: "Something went wrong while loading artist facts." }, { status: 500 });
  }
}
