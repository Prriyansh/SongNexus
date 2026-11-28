import { parseDetailsParams, ValidationError } from "@/lib/musicbrainz";
import { similarToArtist, similarToSong } from "@/lib/similar";
import { answer, CACHE, ok } from "../respond";

// Several sources, one after another for MusicBrainz's sake, so allow time when nothing is cached.
export const maxDuration = 60;

// GET /api/similar?kind=artist|song&id=<MusicBrainz id>[&songs=0]
// Artists and songs similar to this one, each with the reasons it's there. songs=0 (artists only)
// leaves out similar songs.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return answer("similar", "finding similar music", async () => {
    const kind = params.get("kind");
    if (kind !== "artist" && kind !== "song") {
      throw new ValidationError('Query param "kind" must be "artist" or "song".');
    }
    const type = kind === "artist" ? "artist" : "recording";
    const { id } = parseDetailsParams(new URLSearchParams({ type, id: params.get("id") ?? "" }));
    const songs = params.get("songs") !== "0";
    const similar =
      kind === "artist" ? await similarToArtist(id, {}, { songs }) : await similarToSong(id);
    // Keep only a whole answer: every source heard from, and something in each part asked for.
    const settled =
      similar.sources.every((s) => s.status !== "failed") &&
      similar.artists.length > 0 &&
      (similar.songs.length > 0 || !songs);
    return ok({ similar }, settled ? CACHE.hour : CACHE.never);
  });
}
