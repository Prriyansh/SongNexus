import { NextResponse } from "next/server";
import {
  lookupMusicBrainz,
  parseDetailsParams,
  UpstreamError,
  ValidationError,
} from "@/lib/musicbrainz";

// Enriches a single selected artist/recording via MusicBrainz lookup (genres,
// discography, rating, links). Only the two selected items are looked up, so a
// full comparison costs at most two upstream calls — both heavily cached.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  let params;
  try {
    params = parseDetailsParams(searchParams);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const details = await lookupMusicBrainz(params);
    return NextResponse.json(
      { details },
      { headers: { "Cache-Control": "public, max-age=600" } }
    );
  } catch (error) {
    if (error instanceof UpstreamError) {
      console.error(
        `[musicbrainz] lookup failure (${error.status}): ${error.message}`
      );
      return NextResponse.json(
        { error: error.message, retryable: error.retryable },
        { status: error.status }
      );
    }
    console.error("[musicbrainz] unexpected lookup failure:", error);
    return NextResponse.json(
      { error: "Something went wrong while loading details." },
      { status: 500 }
    );
  }
}
