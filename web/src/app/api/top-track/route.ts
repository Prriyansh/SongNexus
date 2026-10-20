import { NextResponse } from "next/server";
import { UpstreamError } from "@/lib/musicbrainz";
import { findTopTrack } from "@/lib/top-track";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/top-track?id=<MusicBrainz artist id>&name=<artist name>
// The artist's most popular song (ranked by Deezer), as a MusicBrainz recording.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = (searchParams.get("id") ?? "").trim();
  const name = (searchParams.get("name") ?? "").trim();
  if (!UUID_RE.test(id) || name.length < 1 || name.length > 200) {
    return NextResponse.json(
      { error: 'Query params "id" (MusicBrainz artist UUID) and "name" are required.' },
      { status: 400 }
    );
  }

  try {
    const track = await findTopTrack({ id, name });
    return NextResponse.json(
      { track },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  } catch (error) {
    if (error instanceof UpstreamError) {
      console.error(`[top-track] upstream failure (${error.status}): ${error.message}`);
      return NextResponse.json(
        { error: error.message, retryable: error.retryable },
        { status: error.status }
      );
    }
    console.error("[top-track] unexpected failure:", error);
    return NextResponse.json({ error: "Something went wrong while finding top tracks." }, { status: 500 });
  }
}
