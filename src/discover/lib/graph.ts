// The artist graph: two artists are connected when a credited fact links them. Each kind of fact
// has a weight, and a connection's strength is the sum over its facts of the chosen kinds. The
// weights are a documented rule of thumb for "how closely", not a measurement.
import type { Catalog, Credit } from "./catalog";
import { CATEGORIES, type Category } from "./types";

export type Kind =
  | "performed_with"
  | "produced_for"
  | "co_produced"
  | "contributed_to"
  | "sampled"
  | "member_of"
  | "collaboration"
  | "supported"
  | "taught"
  | "label_mates"
  | "engineered";

export const KIND_RULES: Record<Kind, { weight: number; category: Category }> = {
  performed_with: { weight: 1, category: "features" },
  produced_for: { weight: 1, category: "producers" },
  co_produced: { weight: 0.6, category: "producers" },
  contributed_to: { weight: 0.6, category: "contributions" },
  sampled: { weight: 0.4, category: "samples" },
  member_of: { weight: 3, category: "bands" },
  collaboration: { weight: 2, category: "bands" },
  supported: { weight: 1, category: "bands" },
  taught: { weight: 1, category: "bands" },
  label_mates: { weight: 0.2, category: "labels" },
  engineered: { weight: 0.25, category: "engineering" },
};

const RELATION_KINDS: Record<string, Kind> = {
  member_of: "member_of",
  has_subgroup: "member_of",
  performs_as: "member_of",
  collaboration_in: "collaboration",
  supported: "supported",
  taught: "taught",
};

const CONTRIBUTORS = new Set([
  "vocal",
  "instrument",
  "performer",
  "programming",
  "arranger",
  "conductor",
  "remixer",
]);
/** Labels with more artists than this connect people who never met. */
export const MAX_LABEL_ARTISTS = 40;
/** Albums on one label within this many years make two artists label mates. */
export const LABEL_MATE_YEARS = 3;

/** One fact connecting artist `a` to artist `b`; a and b keep their roles (a produced for b). */
export type Evidence = {
  kind: Kind;
  a: number;
  b: number;
  aRole: string;
  bRole: string;
  detail: string;
  subject: { type: "song" | "release" | "relation" | "label"; at: number };
  year: number | null;
};

type Add = (evidence: Evidence) => void;

/** Every pair a song's or album's credits connect. Two contributors who only share a song don't count. */
function creditPairs(
  credits: Credit[],
  subject: Evidence["subject"],
  year: number | null,
  add: Add,
) {
  const roles = new Map<number, Map<string, string>>();
  for (const { artist, role, detail } of credits) {
    const own = roles.get(artist) ?? new Map<string, string>();
    if (!own.has(role)) own.set(role, detail);
    roles.set(artist, own);
  }
  const having = (test: (role: string) => boolean) =>
    [...roles].filter(([, own]) => [...own.keys()].some(test)).map(([a]) => a);
  const performers = having((r) => r === "primary" || r === "featured");
  const producers = having((r) => r === "producer");
  const performerRole = (a: number) => (roles.get(a)!.has("primary") ? "primary" : "featured");
  const pair = (kind: Kind, a: number, b: number, aRole: string, bRole: string, detail = "") => {
    if (a !== b) add({ kind, a, b, aRole, bRole, detail, subject, year });
  };
  performers.forEach((a, i) =>
    performers
      .slice(i + 1)
      .forEach((b) => pair("performed_with", a, b, performerRole(a), performerRole(b))),
  );
  producers.forEach((a, i) =>
    producers.slice(i + 1).forEach((b) => pair("co_produced", a, b, "producer", "producer")),
  );
  const contributors = having((r) => CONTRIBUTORS.has(r));
  const engineers = having((r) => r === "engineer");
  const sampled = having((r) => r === "sampled");
  for (const performer of performers) {
    const role = performerRole(performer);
    producers.forEach((a) => pair("produced_for", a, performer, "producer", role));
    for (const a of contributors) {
      const [own, detail] = [...roles.get(a)!].find(([r]) => CONTRIBUTORS.has(r))!;
      pair("contributed_to", a, performer, own, role, detail);
    }
    engineers.forEach((a) =>
      pair("engineered", a, performer, "engineer", role, roles.get(a)!.get("engineer") ?? ""),
    );
    sampled.forEach((a) => pair("sampled", a, performer, "sampled", role));
  }
}

function releaseCredits(catalog: Catalog, at: number): Credit[] {
  const release = catalog.releases[at];
  return [
    ...release.artists.map((artist) => ({ artist, role: "primary", detail: "" })),
    ...release.credits,
  ];
}

/** Each label's artists with the years of their albums there, leaving out labels too broad to mean anything. */
function labelYears(catalog: Catalog, label: number): Map<number, Set<number>> | null {
  const years = new Map<number, Set<number>>();
  for (const at of catalog.labelReleases[label]) {
    const { year, artists } = catalog.releases[at];
    if (year !== null) artists.forEach((a) => years.set(a, (years.get(a) ?? new Set()).add(year)));
  }
  return years.size > MAX_LABEL_ARTISTS ? null : years;
}

function labelPairs(catalog: Catalog, label: number, add: Add) {
  const years = [...(labelYears(catalog, label) ?? [])];
  years.forEach(([a, own], i) => {
    for (const [b, theirs] of years.slice(i + 1)) {
      if ([...own].some((x) => [...theirs].some((y) => Math.abs(x - y) <= LABEL_MATE_YEARS))) {
        add({
          kind: "label_mates",
          a,
          b,
          aRole: "label mate",
          bRole: "label mate",
          detail: "",
          subject: { type: "label", at: label },
          year: null,
        });
      }
    }
  });
}

function relationPair(catalog: Catalog, at: number, add: Add) {
  const { subject, object, type, begin } = catalog.relations[at];
  const kind = RELATION_KINDS[type];
  if (kind && subject !== object) {
    add({
      kind,
      a: subject,
      b: object,
      aRole: type,
      bRole: type,
      detail: "",
      subject: { type: "relation", at },
      year: begin,
    });
  }
}

/** Strength per category of one connection. */
export type Edge = { strength: Float32Array; count: Uint16Array };
export type Graph = { catalog: Catalog; edges: Map<number, Edge>[] };

const CATEGORY_AT = Object.fromEntries(CATEGORIES.map((c, i) => [c, i])) as Record<
  Category,
  number
>;

/** Builds the whole graph once: about 100,000 credits take well under a second. */
export function buildGraph(catalog: Catalog): Graph {
  const edges: Map<number, Edge>[] = catalog.artists.map(() => new Map());
  const add: Add = ({ kind, a, b }) => {
    let edge = edges[a].get(b);
    if (!edge) {
      edge = {
        strength: new Float32Array(CATEGORIES.length),
        count: new Uint16Array(CATEGORIES.length),
      };
      edges[a].set(b, edge);
      edges[b].set(a, edge);
    }
    const rule = KIND_RULES[kind];
    edge.strength[CATEGORY_AT[rule.category]] += rule.weight;
    edge.count[CATEGORY_AT[rule.category]] += 1;
  };
  catalog.songs.forEach((song, at) =>
    creditPairs(song.credits, { type: "song", at }, song.year, add),
  );
  catalog.releases.forEach((release, at) =>
    creditPairs(releaseCredits(catalog, at), { type: "release", at }, release.year, add),
  );
  catalog.relations.forEach((_, at) => relationPair(catalog, at, add));
  catalog.labels.forEach((_, at) => labelPairs(catalog, at, add));
  return { catalog, edges };
}

export function strengthOf(edge: Edge, categories: readonly Category[]): number {
  return categories.reduce((sum, c) => sum + edge.strength[CATEGORY_AT[c]], 0);
}

export function countOf(edge: Edge, categories: readonly Category[]): number {
  return categories.reduce((sum, c) => sum + edge.count[CATEGORY_AT[c]], 0);
}

/** The category that contributes most to a connection (the first listed wins a tie). */
export function mainCategory(edge: Edge, categories: readonly Category[]): Category {
  return categories.reduce((best, c) =>
    edge.strength[CATEGORY_AT[c]] > edge.strength[CATEGORY_AT[best]] ? c : best,
  );
}

/** Everyone connected to an artist through these categories, strongest first. */
export function neighbors(
  graph: Graph,
  artist: number,
  categories: readonly Category[],
): { artist: number; strength: number; edge: Edge }[] {
  return [...graph.edges[artist]]
    .map(([other, edge]) => ({ artist: other, strength: strengthOf(edge, categories), edge }))
    .filter((n) => n.strength > 0)
    .sort((x, y) => y.strength - x.strength || x.artist - y.artist);
}

/** Every fact connecting two artists, strongest kinds first, then oldest. */
export function evidenceBetween(
  catalog: Catalog,
  x: number,
  y: number,
  categories: readonly Category[],
): Evidence[] {
  const found: Evidence[] = [];
  const add: Add = (e) => {
    if (
      ((e.a === x && e.b === y) || (e.a === y && e.b === x)) &&
      categories.includes(KIND_RULES[e.kind].category)
    )
      found.push(e);
  };
  const shared = (lists: number[][]) => {
    const own = new Set(lists[x]);
    return [...new Set(lists[y])].filter((at) => own.has(at));
  };
  shared(catalog.songsOf).forEach((at) =>
    creditPairs(catalog.songs[at].credits, { type: "song", at }, catalog.songs[at].year, add),
  );
  shared(catalog.releasesOf).forEach((at) =>
    creditPairs(
      releaseCredits(catalog, at),
      { type: "release", at },
      catalog.releases[at].year,
      add,
    ),
  );
  shared(catalog.relationsOf).forEach((at) => relationPair(catalog, at, add));
  if (categories.includes("labels")) {
    const labelsOf = (artist: number) =>
      new Set(
        catalog.releasesOf[artist].flatMap((at) =>
          catalog.releases[at].artists.includes(artist) ? catalog.releases[at].labels : [],
        ),
      );
    const own = labelsOf(x);
    labelsOf(y).forEach((label) => own.has(label) && labelPairs(catalog, label, add));
  }
  const weight = (e: Evidence) => KIND_RULES[e.kind].weight;
  return found.sort((p, q) => weight(q) - weight(p) || (p.year ?? 9999) - (q.year ?? 9999));
}
