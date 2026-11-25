// What Discover's pages and API routes pass to the browser. Safe to import from client components.

/** User-facing groups of connections. Labels and engineering connect nearly everyone, so they start off. */
export const CATEGORIES = ["features", "producers", "contributions", "samples", "bands", "labels", "engineering"] as const;
export type Category = (typeof CATEGORIES)[number];
export const DEFAULT_CATEGORIES: readonly Category[] = ["features", "producers", "contributions", "samples", "bands"];

export const CATEGORY_LABELS: Record<Category, string> = {
  features: "Performed together",
  producers: "Production",
  contributions: "Played or sang on",
  samples: "Samples",
  bands: "Bands and projects",
  labels: "Same label, same years",
  engineering: "Engineering",
};

export type EntityKind = "artist" | "song" | "label" | "genre";

export type EntityRef = { kind: EntityKind; id: string; name: string; note: string };

export type ArtistRef = { id: string; name: string; note: string; listeners: number | null };

/** One reason two artists are connected, as a sentence, with the song or label it is about. */
export type Reason = { category: Category; text: string; subject: EntityRef | null; year: number | null };

export type PathStep = { from: ArtistRef; to: ArtistRef; reasons: Reason[]; reasonCount: number };
export type FoundPath = { artists: ArtistRef[]; steps: PathStep[] };
export type PathSearch =
  | { status: "ok"; paths: FoundPath[] }
  | { status: "same-artist" | "not-connected" };

export type GraphNode = ArtistRef & { degree: number };
export type GraphEdge = { a: string; b: string; strength: number; category: Category; count: number };
export type GraphData = { center: string; nodes: GraphNode[]; edges: GraphEdge[]; total: number };

/** Reads a comma-separated list of categories; nothing valid means the defaults. */
export function parseCategories(value: string | null | undefined): Category[] {
  const asked = new Set((value ?? "").split(","));
  const found = CATEGORIES.filter((c) => asked.has(c));
  return found.length ? found : [...DEFAULT_CATEGORIES];
}

export const isDefaultCategories = (categories: readonly Category[]) =>
  categories.length === DEFAULT_CATEGORIES.length && DEFAULT_CATEGORIES.every((c) => categories.includes(c));

export const entityHref = (ref: { kind: EntityKind; id: string }) => `/discover/${ref.kind}/${ref.id}`;
