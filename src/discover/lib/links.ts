// Addresses that carry a whole search, so any view can be shared. Used by server and client code.
import type { PathOrder } from "./paths";
import { isDefaultCategories, type ArtistRef, type Category } from "./types";

export type SixDegreesState = {
  from: ArtistRef | null;
  to: ArtistRef | null;
  categories: Category[];
  order: PathOrder;
  avoid: ArtistRef[];
};

export function sixDegreesHref({ from, to, categories, order, avoid }: SixDegreesState): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from.id);
  if (to) params.set("to", to.id);
  if (!isDefaultCategories(categories)) params.set("via", categories.join(","));
  if (order !== "shortest") params.set("order", order);
  if (avoid.length) params.set("avoid", avoid.map((a) => a.id).join(","));
  const query = params.toString();
  return query ? `/discover/six-degrees?${query}` : "/discover/six-degrees";
}

export function connectionsHref(artist: string, categories: readonly Category[]): string {
  const params = new URLSearchParams({ artist });
  if (!isDefaultCategories(categories)) params.set("via", categories.join(","));
  return `/discover/connections?${params}`;
}
