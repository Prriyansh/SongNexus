import { graph, neighborhood } from "@/discover/lib/server";
import { parseCategories } from "@/discover/lib/types";

// The catalog only changes with a deploy.
const CACHE = { headers: { "Cache-Control": "public, max-age=600" } };
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 40;

// An artist's strongest connections: ?artist=<mbid>&categories=features,bands&limit=20.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const g = graph();
  const artist = g.catalog.artistAt.get((params.get("artist") ?? "").toLowerCase());
  if (artist === undefined) return Response.json({ error: "This artist isn’t in Discover’s catalog." }, { status: 404 });
  const asked = Number(params.get("limit"));
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;
  return Response.json(neighborhood(g, artist, parseCategories(params.get("categories")), limit), CACHE);
}
