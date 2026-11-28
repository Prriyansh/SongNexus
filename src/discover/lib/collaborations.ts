// Who an artist worked with, grouped the way listeners think about it.
import { evidenceBetween, neighbors, type Evidence, type Graph } from "./graph";
import { CATEGORIES, type ArtistRef, type Category } from "./types";
import { artistRef } from "./words";

export const COLLABORATION_TYPES = ["features", "production", "bands", "credits"] as const;
export type CollaborationType = (typeof COLLABORATION_TYPES)[number];

export const COLLABORATION_LABELS: Record<CollaborationType, string> = {
  features: "Performed with",
  production: "Production",
  bands: "Bands and projects",
  credits: "Other credits",
};

const TYPE_CATEGORIES: Record<CollaborationType, readonly Category[]> = {
  features: ["features"],
  production: ["producers"],
  bands: ["bands"],
  credits: ["contributions", "samples", "engineering"],
};

export type Direction = "produced for them" | "produced by them" | "produced together";

export type Collaboration = {
  artist: ArtistRef;
  /** Distinct songs, albums or relationships behind it. */
  count: number;
  firstYear: number | null;
  lastYear: number | null;
  directions: Direction[];
};

const subjectKey = (e: Evidence) => `${e.subject.type}:${e.subject.at}`;

function directionsOf(found: Evidence[], artist: number): Direction[] {
  const out = new Set<Direction>();
  for (const e of found) {
    if (e.kind === "co_produced") out.add("produced together");
    if (e.kind === "produced_for")
      out.add(e.a === artist ? "produced for them" : "produced by them");
  }
  return [...out].sort();
}

/** Collaborators of one type, most shared work first, and how many there are in all. */
export function collaborations(
  graph: Graph,
  artist: number,
  type: CollaborationType,
  limit: number,
): { items: Collaboration[]; total: number } {
  const categories = TYPE_CATEGORIES[type];
  const items = neighbors(graph, artist, categories).map(({ artist: other }) => {
    const found = evidenceBetween(graph.catalog, artist, other, categories);
    const years = found.map((e) => e.year).filter((y): y is number => y !== null);
    return {
      other,
      count: new Set(found.map(subjectKey)).size,
      firstYear: years.length ? Math.min(...years) : null,
      lastYear: years.length ? Math.max(...years) : null,
      directions: directionsOf(found, artist),
    };
  });
  items.sort(
    (x, y) =>
      y.count - x.count || (x.firstYear ?? 9999) - (y.firstYear ?? 9999) || x.other - y.other,
  );
  return {
    total: items.length,
    items: items
      .slice(0, limit)
      .map(({ other, ...rest }) => ({ artist: artistRef(graph.catalog, other), ...rest })),
  };
}

export type TimelineYear = { year: number; count: number };

/** Distinct songs and albums an artist made with someone else, per year (undated ones left out). */
export function timeline(graph: Graph, artist: number): TimelineYear[] {
  const years = new Map<number, Set<string>>();
  const categories = CATEGORIES.filter((c) => c !== "labels" && c !== "bands");
  for (const { artist: other } of neighbors(graph, artist, categories)) {
    for (const e of evidenceBetween(graph.catalog, artist, other, categories)) {
      if (e.year !== null)
        years.set(e.year, (years.get(e.year) ?? new Set<string>()).add(subjectKey(e)));
    }
  }
  return [...years]
    .sort(([x], [y]) => x - y)
    .map(([year, subjects]) => ({ year, count: subjects.size }));
}
