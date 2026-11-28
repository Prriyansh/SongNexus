import { evidenceBetween } from "@/discover/lib/graph";
import { graph } from "@/discover/lib/server";
import { parseCategories } from "@/discover/lib/types";
import { reasonOf } from "@/discover/lib/words";

// The catalog only changes with a deploy.
const CACHE = {
  headers: { "Cache-Control": "public, max-age=600, s-maxage=86400, stale-while-revalidate=86400" },
};
const MAX_REASONS = 8;

// Why two artists are connected: ?a=<mbid>&b=<mbid>&categories=features,bands.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const g = graph();
  const [a, b] = ["a", "b"].map((key) =>
    g.catalog.artistAt.get((params.get(key) ?? "").toLowerCase()),
  );
  if (a === undefined || b === undefined)
    return Response.json({ error: "This artist isn’t in Discover’s catalog." }, { status: 404 });
  const found = evidenceBetween(g.catalog, a, b, parseCategories(params.get("categories")));
  return Response.json(
    {
      reasons: found.slice(0, MAX_REASONS).map((e) => reasonOf(g.catalog, e)),
      total: found.length,
    },
    CACHE,
  );
}
