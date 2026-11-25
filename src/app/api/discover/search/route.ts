import { catalog } from "@/discover/lib/catalog";
import { searchCatalog } from "@/discover/lib/search";
import type { EntityKind } from "@/discover/lib/types";

// The catalog only changes with a deploy.
const CACHE = { headers: { "Cache-Control": "public, max-age=600" } };
const KINDS: readonly EntityKind[] = ["artist", "song", "label", "genre"];
const MAX_QUERY = 120;

// Names in Discover's catalog: ?q=queen&kinds=artist,song (all kinds without `kinds`).
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  if (!q || q.length > MAX_QUERY) {
    return Response.json({ error: `Query param "q" must be 1–${MAX_QUERY} characters.` }, { status: 400 });
  }
  const asked = (params.get("kinds") ?? "").split(",");
  const kinds = KINDS.filter((kind) => asked.includes(kind));
  return Response.json({ results: searchCatalog(catalog(), q, kinds.length ? kinds : KINDS) }, CACHE);
}
