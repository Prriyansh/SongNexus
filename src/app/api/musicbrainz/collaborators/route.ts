import { NextResponse } from "next/server";
import {
  compareCollaborators,
  parseCollaboratorParams,
  UpstreamError,
  ValidationError,
} from "@/lib/musicbrainz";

// People credited on recordings by both artists (producers, features, mixers, performers).
// Reads each artist's most recent studio albums (one MusicBrainz request per album, ~1/s), so a
// cold comparison takes ~10 s; results are cached and the UI loads this after the main cards.
// Allow time for that on serverless hosts whose default function timeout is shorter.
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  let params;
  try {
    params = parseCollaboratorParams(searchParams);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const collaborators = await compareCollaborators(params);
    return NextResponse.json(
      { collaborators },
      { headers: { "Cache-Control": "public, max-age=600" } }
    );
  } catch (error) {
    if (error instanceof UpstreamError) {
      console.error(`[musicbrainz] collaborators failure (${error.status}): ${error.message}`);
      return NextResponse.json(
        { error: error.message, retryable: error.retryable },
        { status: error.status }
      );
    }
    console.error("[musicbrainz] unexpected collaborators failure:", error);
    return NextResponse.json(
      { error: "Something went wrong while finding shared collaborators." },
      { status: 500 }
    );
  }
}
