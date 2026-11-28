import { friendPathsOf, MAX_ARTISTS, MAX_SIDE, nexusOf } from "@/discover/lib/nexus";
import { artistsIn } from "@/discover/lib/query";
import { graph } from "@/discover/lib/server";

// The answer depends only on the address, and the catalog only changes with a deploy.
const CACHE = { headers: { "Cache-Control": "public, max-age=600, s-maxage=86400" } };

// How artists hang together: ?artists=<ids>. With &theirs=<ids>, the paths between two people's
// artists instead (`artists` being yours).
export async function GET(request: Request) {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const g = graph();
  if (query.theirs === undefined)
    return Response.json(nexusOf(g, artistsIn(query, "artists", g.catalog.artistAt, MAX_ARTISTS)), CACHE);
  const [mine, theirs] = ["artists", "theirs"].map((key) => artistsIn(query, key, g.catalog.artistAt, MAX_SIDE));
  return Response.json(friendPathsOf(g, mine, theirs), CACHE);
}
