// The catalog's graph and the answers pages and API routes ask of it. Server only.
import { catalog } from "./catalog";
import {
  buildGraph,
  countOf,
  evidenceBetween,
  mainCategory,
  neighbors,
  strengthOf,
  type Graph,
} from "./graph";
import { findPaths, type PathOrder } from "./paths";
import type { Category, GraphData, GraphEdge, PathSearch } from "./types";
import { artistRef, reasonOf } from "./words";

let built: Graph | null = null;

/** The whole artist graph, built once per server instance. */
export function graph(): Graph {
  built ??= buildGraph(catalog());
  return built;
}

const REASONS_PER_STEP = 3;

export function searchPaths(
  g: Graph,
  from: number,
  to: number,
  categories: readonly Category[],
  order: PathOrder,
  avoid: number[] = [],
): PathSearch {
  if (from === to) return { status: "same-artist" };
  const paths = findPaths(g, from, to, { categories, order, avoid: new Set(avoid) });
  if (!paths.length) return { status: "not-connected" };
  return {
    status: "ok",
    paths: paths.map((path) => ({
      artists: path.map((a) => artistRef(g.catalog, a)),
      steps: path.slice(1).map((artist, i) => {
        const found = evidenceBetween(g.catalog, path[i], artist, categories);
        return {
          from: artistRef(g.catalog, path[i]),
          to: artistRef(g.catalog, artist),
          reasons: found.slice(0, REASONS_PER_STEP).map((e) => reasonOf(g.catalog, e)),
          reasonCount: found.length,
        };
      }),
    })),
  };
}

/** An artist's strongest connections and the connections among those. */
export function neighborhood(
  g: Graph,
  artist: number,
  categories: readonly Category[],
  limit: number,
): GraphData {
  const all = neighbors(g, artist, categories);
  const shown = [artist, ...all.slice(0, limit).map((n) => n.artist)];
  const edges: GraphEdge[] = [];
  shown.forEach((a, i) => {
    for (const b of shown.slice(i + 1)) {
      const edge = g.edges[a].get(b);
      if (!edge || strengthOf(edge, categories) <= 0) continue;
      edges.push({
        a: g.catalog.artists[a].id,
        b: g.catalog.artists[b].id,
        strength: strengthOf(edge, categories),
        category: mainCategory(edge, categories),
        count: countOf(edge, categories),
      });
    }
  });
  return {
    center: g.catalog.artists[artist].id,
    nodes: shown.map((a) => ({
      ...artistRef(g.catalog, a),
      degree: neighbors(g, a, categories).length,
    })),
    edges,
    total: all.length,
  };
}
