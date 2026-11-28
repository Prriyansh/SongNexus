// What Discover's pages and API routes pass to the browser. Safe to import from client components.

/** User-facing groups of connections. Labels and engineering connect nearly everyone, so they start off. */
export const CATEGORIES = [
  "features",
  "producers",
  "contributions",
  "samples",
  "bands",
  "labels",
  "engineering",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const DEFAULT_CATEGORIES: readonly Category[] = [
  "features",
  "producers",
  "contributions",
  "samples",
  "bands",
];

/** Everyone an artist worked with, in any way. Sharing a label is not working together. */
export const WORKING_CATEGORIES: readonly Category[] = CATEGORIES.filter((c) => c !== "labels");

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

/** Something with a page of its own. `image` is an artist's photo or an album cover. */
export type EntityRef = {
  kind: EntityKind;
  id: string;
  name: string;
  note: string;
  image?: string | null;
};

export type ArtistRef = {
  id: string;
  name: string;
  note: string;
  listeners: number | null;
  photo: string | null;
};

/** One reason two artists are connected, as a sentence, with the song or label it is about. */
export type Reason = {
  category: Category;
  text: string;
  subject: EntityRef | null;
  year: number | null;
};

/** An artist For You suggests, and why: a favourite they're connected to, or a favourite genre. */
export type ForYouPick = {
  artist: ArtistRef;
  because: ArtistRef | null;
  reason: Reason | null;
  genre: EntityRef | null;
};

export type PathStep = { from: ArtistRef; to: ArtistRef; reasons: Reason[]; reasonCount: number };
export type FoundPath = { artists: ArtistRef[]; steps: PathStep[] };
export type PathSearch =
  { status: "ok"; paths: FoundPath[] } | { status: "same-artist" | "not-connected" };

export type GraphNode = ArtistRef & { degree: number };
export type GraphEdge = {
  a: string;
  b: string;
  strength: number;
  category: Category;
  count: number;
};
export type GraphData = { center: string; nodes: GraphNode[]; edges: GraphEdge[]; total: number };

/** How many connections opening an artist in a web adds. */
export const OPEN_LIMIT = 12;

/** Reads a comma-separated list of categories; nothing valid means the defaults. */
export function parseCategories(value: string | null | undefined): Category[] {
  const asked = new Set((value ?? "").split(","));
  const found = CATEGORIES.filter((c) => asked.has(c));
  return found.length ? found : [...DEFAULT_CATEGORIES];
}

export const isDefaultCategories = (categories: readonly Category[]) =>
  categories.length === DEFAULT_CATEGORIES.length &&
  DEFAULT_CATEGORIES.every((c) => categories.includes(c));

export const entityHref = (ref: { kind: EntityKind; id: string }) =>
  `/discover/${ref.kind}/${ref.id}`;
