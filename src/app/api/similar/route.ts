import { NextResponse } from "next/server";
import { parseDetailsParams, UpstreamError, ValidationError } from "@/lib/musicbrainz";
import { similarToArtist, similarToSong } from "@/lib/similar";

// Several sources, one after another for MusicBrainz's sake, so allow time when nothing is cached.
export const maxDuration = 60;

// GET /api/similar?kind=artist|song&id=<MusicBrainz id>
// Artists and songs similar to this one, each with the reasons it's there.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  try {
    if (kind !== "artist" && kind !== "song") throw new ValidationError('Query param "kind" must be "artist" or "song".');
    const { id } = parseDetailsParams(new URLSearchParams({ type: kind === "artist" ? "artist" : "recording", id: searchParams.get("id") ?? "" }));
    const similar = kind === "artist" ? await similarToArtist(id) : await similarToSong(id);
    const settled = similar.sources.every((s) => s.status !== "failed") && similar.songs.length > 0 && similar.artists.length > 0;
    return NextResponse.json({ similar }, { headers: { "Cache-Control": settled ? "public, max-age=3600" : "no-store" } });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof UpstreamError) return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.status });
    console.error("[similar] unexpected failure:", error);
    return NextResponse.json({ error: "Something went wrong while finding similar music." }, { status: 500 });
  }
}
