// Reading a page's address.

type Query = Record<string, string | string[] | undefined>;

/** A parameter's value, the first if it is repeated, or "". */
export function oneOf(query: Query, key: string): string {
  const value = query[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The artists a comma-separated parameter names, without unknown ones and repeats. */
export function artistsIn(
  query: Query,
  key: string,
  artistAt: ReadonlyMap<string, number>,
  limit: number,
): number[] {
  const ids = oneOf(query, key).toLowerCase().split(",");
  const found = ids.map((id) => artistAt.get(id)).filter((at) => at !== undefined);
  return [...new Set(found)].slice(0, limit);
}
