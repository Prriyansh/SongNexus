// Six Degrees: the ways two artists are connected through people they worked with.
import { strengthOf, type Graph } from "./graph";
import type { Category } from "./types";

/** Six steps at most, as in the name. */
export const MAX_STEPS = 6;
export const MAX_PATHS = 3;

export type PathOrder = "shortest" | "strongest";

type Options = { categories: readonly Category[]; order?: PathOrder; avoid?: ReadonlySet<number>; maxSteps?: number };

/**
 * One best path, or null. `shortest` takes the fewest steps and, among those, the closest
 * connections; `strongest` takes the closest connections overall, however many steps (up to the
 * limit) that takes. A stronger connection costs less (1 / strength).
 */
export function findPath(graph: Graph, from: number, to: number, options: Options): number[] | null {
  const { categories, order = "shortest", avoid = new Set<number>(), maxSteps = MAX_STEPS } = options;
  // `layer` holds, per artist, the cheapest way to reach them in exactly `step` steps.
  let layer = new Map<number, number>([[from, 0]]);
  const parents: Map<number, number>[] = [];
  const reachedAt = new Map<number, number>([[from, 0]]);
  const best = new Map<number, number>([[from, 0]]);
  let answer: { steps: number; cost: number } | null = null;
  for (let step = 1; step <= maxSteps && layer.size; step++) {
    const next = new Map<number, number>();
    const parent = new Map<number, number>();
    for (const [artist, cost] of layer) {
      if (artist === to) continue;
      for (const [other, edge] of graph.edges[artist]) {
        if (other === from || (avoid.has(other) && other !== to)) continue;
        // Shortest: an artist reached in fewer steps never gets a longer way.
        if (order === "shortest" && (reachedAt.get(other) ?? step) < step) continue;
        const strength = strengthOf(edge, categories);
        if (strength <= 0) continue;
        const total = cost + 1 / strength;
        // A longer way only helps when it is cheaper than every shorter one found.
        if (answer && total >= answer.cost) continue;
        const known = next.get(other);
        if (known === undefined || total < known || (total === known && artist < parent.get(other)!)) {
          next.set(other, total);
          parent.set(other, artist);
        }
      }
    }
    if (order === "strongest") {
      // Drop artists already reached more cheaply in fewer steps.
      for (const [artist, cost] of next) {
        const earlier = best.get(artist);
        if (earlier !== undefined && earlier <= cost) next.delete(artist);
        else best.set(artist, cost);
      }
    }
    for (const artist of next.keys()) if (!reachedAt.has(artist)) reachedAt.set(artist, step);
    parents.push(parent);
    const cost = next.get(to);
    if (cost !== undefined && (!answer || cost < answer.cost)) answer = { steps: step, cost };
    if (answer && order === "shortest") break;
    layer = next;
  }
  if (!answer) return null;
  const path = [to];
  for (let step = answer.steps - 1; step >= 0; step--) path.unshift(parents[step].get(path[0])!);
  return path;
}

/** Up to `limit` paths that share no one in between, best first. */
export function findPaths(graph: Graph, from: number, to: number, options: Options, limit = MAX_PATHS): number[][] {
  const avoid = new Set(options.avoid);
  const paths: number[][] = [];
  while (paths.length < limit) {
    const path = findPath(graph, from, to, { ...options, avoid });
    if (!path) break;
    paths.push(path);
    const between = path.slice(1, -1);
    if (!between.length) break; // directly connected: that is the whole answer
    between.forEach((artist) => avoid.add(artist));
  }
  return paths;
}
