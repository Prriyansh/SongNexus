// Addresses that carry a whole view, so any of them can be shared. Used by server and client code.
import type { PathOrder } from "./paths";
import { isDefaultCategories, type ArtistRef, type Category } from "./types";

export type SixDegreesState = {
  from: ArtistRef | null;
  to: ArtistRef | null;
  categories: Category[];
  order: PathOrder;
  avoid: ArtistRef[];
};

type Ends = { from: ArtistRef | null; to: ArtistRef | null };

export function sixDegreesHref(state: Ends & Partial<SixDegreesState>): string {
  const { from, to, categories = [], order = "shortest", avoid = [] } = state;
  const params = new URLSearchParams();
  if (from) params.set("from", from.id);
  if (to) params.set("to", to.id);
  if (categories.length && !isDefaultCategories(categories))
    params.set("via", categories.join(","));
  if (order !== "shortest") params.set("order", order);
  if (avoid.length) params.set("avoid", avoid.map((a) => a.id).join(","));
  const query = params.toString();
  return query ? `/discover/six-degrees?${query}` : "/discover/six-degrees";
}

/** `opened` are the artists whose connections were opened after the starting one, in order. */
export function connectionsHref(
  artist: string,
  categories: readonly Category[],
  opened: readonly string[] = [],
): string {
  const params = new URLSearchParams({ artist });
  if (!isDefaultCategories(categories)) params.set("via", categories.join(","));
  if (opened.length) params.set("open", opened.join(","));
  return `/discover/connections?${params}`;
}
