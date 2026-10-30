import { NextResponse } from "next/server";
import { UpstreamError } from "@/lib/musicbrainz";
import { buildTaste, parseTasteRequest } from "@/lib/taste";

// Looks up each playlist's main artists, so allow time when nothing is cached.
export const maxDuration = 60;

// POST /api/taste { mine: [{ title, artist }], friend?: [...], friendName? }
// A map from one playlist or two. Playlists are used for this response and not stored.
export async function POST(request: Request) {
  const taste = parseTasteRequest(await request.json().catch(() => null));
  if (!taste) return NextResponse.json({ error: "Send at least one song with both a title and an artist, up to 250 per playlist." }, { status: 400 });
  try {
    return NextResponse.json({ taste: await buildTaste(taste) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UpstreamError) return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.status });
    console.error("[taste] unexpected failure:", error);
    return NextResponse.json({ error: "Something went wrong while building this map." }, { status: 500 });
  }
}
