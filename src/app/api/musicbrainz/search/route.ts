import { NextResponse } from "next/server";
import {
  parseSearchParams,
  searchMusicBrainz,
  UpstreamError,
  ValidationError,
} from "@/lib/musicbrainz";

// Proxy MusicBrainz through our own server so the UA header, rate limiting and
// error handling live in one place and no upstream details leak into the client.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  let params;
  try {
    params = parseSearchParams(searchParams);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const results = await searchMusicBrainz(params);
    return NextResponse.json(
      { results },
      // Let the CDN/browser dedupe identical rapid searches too.
      { headers: { "Cache-Control": "public, max-age=60" } }
    );
  } catch (error) {
    if (error instanceof UpstreamError) {
      console.error(
        `[musicbrainz] upstream failure (${error.status}): ${error.message}`
      );
      return NextResponse.json(
        { error: error.message, retryable: error.retryable },
        { status: error.status }
      );
    }
    console.error("[musicbrainz] unexpected failure:", error);
    return NextResponse.json(
      { error: "Something went wrong while searching MusicBrainz." },
      { status: 500 }
    );
  }
}
