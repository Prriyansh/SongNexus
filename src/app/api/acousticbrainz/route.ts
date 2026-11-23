import { NextResponse } from "next/server";
import { ValidationError } from "@/lib/musicbrainz";
import { compareAudio, parseRecordingPair } from "@/lib/acousticbrainz";

// GET /api/acousticbrainz?a=&b=
// What AcousticBrainz measured for two recordings (tempo, key, mood estimates), by MusicBrainz id.
// AcousticBrainz being down is reported in the body, never as an error for the page.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const { a, b } = parseRecordingPair(searchParams);
    const audio = await compareAudio(a, b);
    const cacheable = audio.source.status !== "failed";
    return NextResponse.json({ audio }, { headers: { "Cache-Control": cacheable ? "public, max-age=86400" : "no-store" } });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[acousticbrainz] unexpected failure:", error);
    return NextResponse.json({ error: "Something went wrong while loading AcousticBrainz data." }, { status: 500 });
  }
}
