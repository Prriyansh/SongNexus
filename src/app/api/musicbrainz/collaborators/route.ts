import { NextResponse } from "next/server";
import {
  compareCollaborators,
  parseCollaboratorParams,
  UpstreamError,
  ValidationError,
} from "@/lib/musicbrainz";

// People credited on recordings by both artists (producers, features, mixers, performers).
// Reads each artist's studio albums, newest first (one MusicBrainz request per album, ~1/s), so a
// cold comparison can take most of a minute. Albums are cached and the UI loads this after the main
// cards; a scan that runs out of time reports `partial`, and asking again continues it.
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
      { headers: { "Cache-Control": collaborators.coverage.a.partial || collaborators.coverage.b.partial ? "no-store" : "public, max-age=600" } }
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
