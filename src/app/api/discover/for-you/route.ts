import { forYou, genreIndex, MAX_GENRES, MAX_SEEDS } from "@/discover/lib/for-you";
import { normalize } from "@/discover/lib/search";
import { graph } from "@/discover/lib/server";

// The answer depends only on the address, and the catalog only changes with a deploy.
const CACHE = { headers: { "Cache-Control": "public, max-age=600, s-maxage=86400" } };

// Artists to try: ?artists=<mbid>,<mbid>&genre=hip hop&genre=jazz&hidden=<mbid>,<mbid>.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const c = graph().catalog;
  const artists = (key: string, limit: number) => [
    ...new Set(
      (params.get(key) ?? "")
        .toLowerCase()
        .split(",")
        .map((id) => c.artistAt.get(id))
        .filter((at) => at !== undefined)
        .slice(0, limit),
    ),
  ];
  const index = genreIndex(c);
  const genres = [
    ...new Set(
      params
        .getAll("genre")
        .slice(0, MAX_GENRES)
        .map((name) => index.get(normalize(name)))
        .filter((at) => at !== undefined),
    ),
  ];
  const seeds = artists("artists", MAX_SEEDS);
  return Response.json(
    {
      picks: forYou(graph(), seeds, genres, new Set(artists("hidden", 500))),
      known: { artists: seeds.length, genres: genres.length },
    },
    CACHE,
  );
}
