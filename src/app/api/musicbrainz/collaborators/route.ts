import { compareCollaborators, parseCollaboratorParams } from "@/lib/musicbrainz";
import { answer, CACHE, ok } from "../../respond";

// People credited on recordings by both artists (producers, features, mixers, performers).
// Reads each artist's studio albums, newest first (one MusicBrainz request per album, ~1/s), so a
// cold comparison can take most of a minute. Albums are cached and the UI loads this after the main
// cards; a scan that runs out of time reports `partial`, and asking again continues it.
// Allow time for that on serverless hosts whose default function timeout is shorter.
export const maxDuration = 60;

// GET /api/musicbrainz/collaborators?a=&b=
export async function GET(request: Request) {
  return answer("musicbrainz", "finding shared collaborators", async () => {
    const collaborators = await compareCollaborators(
      parseCollaboratorParams(new URL(request.url).searchParams),
    );
    const partial = collaborators.coverage.a.partial || collaborators.coverage.b.partial;
    return ok({ collaborators }, partial ? CACHE.never : CACHE.tenMinutes);
  });
}
