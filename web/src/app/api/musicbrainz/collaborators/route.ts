import { NextResponse } from "next/server";
import {
  compareCollaborators,
  parseCollaboratorParams,
  UpstreamError,
  ValidationError,
} from "@/lib/musicbrainz";

// People credited on recordings by both artists (producers, features, mixers, performers).
// One MusicBrainz request per artist, cached, so it runs after the main comparison renders.
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
