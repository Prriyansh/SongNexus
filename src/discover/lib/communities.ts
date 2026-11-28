// Around You: what a campus or a country listens to, from signed-in people who choose to share their
// artists. A campus is a Google Workspace domain, so only its own people can join; anyone can join a
// country. A chart stays locked until enough members share, and lists only artists several members
// named, so no one's taste can be picked out. Daily snapshots make the weekly recap. Server only.
import type { Graph } from "./graph";
import type { Store } from "./store";
import type { ArtistRef } from "./types";
import { artistRef, countryName } from "./words";

/** Members sharing artists before a chart opens. */
export const MIN_MEMBERS = 5;
/** Members who must name an artist before it shows. */
export const MIN_NAMES = 2;
export const CHART = 25;
/** Each member shares up to this many artists. */
export const MAX_SHARED = 25;
/** Members read for a chart, the earliest first. */
export const MAX_MEMBERS = 1000;
/** Shared artists, memberships and snapshots last this long unless renewed. */
const TTL = 35 * 86_400;
/** The recap compares with a snapshot at least a week old, and at most two. */
const WEEK = 7;

export type Community = { id: string; kind: "campus" | "country"; name: string };

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** A community from its ID, `campus:wisc.edu` or `country:US`; null for anything else. */
export function communityOf(id: string): Community | null {
  const [kind, key = ""] = id.split(":");
  if (kind === "campus" && DOMAIN.test(key) && key.length <= 100) return { id, kind, name: key };
  const name = kind === "country" && /^[A-Z]{2}$/.test(key) ? countryName(key) : null;
  return name ? { id, kind: "country", name } : null;
}

const membersKey = (id: string) => `community:${id}:members`;
const sharedKey = (id: string, sub: string) => `community:${id}:shared:${sub}`;
const snapshotKey = (id: string, day: number) => `community:${id}:chart:${day}`;
const joinedKey = (sub: string) => `communities:${sub}`;

/** The communities a person belongs to. */
export async function memberships(store: Store, sub: string): Promise<string[]> {
  return JSON.parse((await store.get(joinedKey(sub))) ?? "[]") as string[];
}

/** Joins a community (or renews membership), sharing these artist IDs. */
export async function join(store: Store, id: string, sub: string, artists: string[], now = Date.now()) {
  await store.rankNew(membersKey(id), sub, now, TTL);
  await store.set(sharedKey(id, sub), JSON.stringify(artists.slice(0, MAX_SHARED)), TTL);
  const joined = await memberships(store, sub);
  await store.set(joinedKey(sub), JSON.stringify([...new Set([...joined, id])]), TTL);
}

export async function leave(store: Store, id: string, sub: string) {
  await store.unrank(membersKey(id), sub);
  await store.del(sharedKey(id, sub));
  const joined = (await memberships(store, sub)).filter((c) => c !== id);
  await store.set(joinedKey(sub), JSON.stringify(joined), TTL);
}

/** Leaves every community, as deleting an account does. */
export async function leaveAll(store: Store, sub: string) {
  for (const id of await memberships(store, sub)) await leave(store, id, sub);
  await store.del(joinedKey(sub));
}

export type ChartRow = { artist: ArtistRef; members: number };
export type Moved = { artist: ArtistRef; from: number; to: number };
export type Recap = { rose: Moved[]; fell: Moved[]; entered: ArtistRef[]; left: ArtistRef[] };
export type View = Community & {
  members: number;
  sharing: number;
  /** How many more members must share before the chart opens; 0 once it has. */
  needed: number;
  chart: ChartRow[];
  recap: Recap | null;
  joined: boolean;
};

/** Artists in chart order: most members first, then most listened to. */
async function rank(g: Graph, store: Store, id: string): Promise<{ members: number; sharing: number; rows: [number, number][] }> {
  const c = g.catalog;
  const members = await store.top(membersKey(id), MAX_MEMBERS);
  const shared = await Promise.all(members.map(([sub]) => store.get(sharedKey(id, sub))));
  const counts = new Map<number, number>();
  let sharing = 0;
  for (const list of shared) {
    const artists = new Set(((JSON.parse(list ?? "[]") as string[]).map((a) => c.artistAt.get(a)).filter((a) => a !== undefined)));
    if (artists.size) sharing++;
    for (const artist of artists) counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  const rows = [...counts]
    .filter(([, n]) => n >= MIN_NAMES)
    .sort(([x, p], [y, q]) => q - p || (c.artists[y].listeners ?? 0) - (c.artists[x].listeners ?? 0) || x - y)
    .slice(0, CHART);
  return { members: members.length, sharing, rows };
}

/** What moved between an earlier chart and this one (artist IDs in order). */
export function recapOf(g: Graph, before: string[], now: string[]): Recap {
  const ref = (id: string) => artistRef(g.catalog, g.catalog.artistAt.get(id)!);
  const moves = now.flatMap((id, to) => {
    const from = before.indexOf(id);
    return from < 0 || from === to ? [] : [{ artist: ref(id), from: from + 1, to: to + 1 }];
  });
  return {
    rose: moves.filter((m) => m.to < m.from),
    fell: moves.filter((m) => m.to > m.from),
    entered: now.filter((id) => !before.includes(id)).map(ref),
    left: before.filter((id) => !now.includes(id) && g.catalog.artistAt.has(id)).map(ref),
  };
}

/** A community's chart for a day, saving the day's snapshot and recapping the week once it's open. */
export async function viewOf(g: Graph, store: Store, community: Community, day: number, sub: string | null): Promise<View> {
  const { members, sharing, rows } = await rank(g, store, community.id);
  const needed = Math.max(0, MIN_MEMBERS - sharing);
  const joined = sub !== null && (await store.place(membersKey(community.id), sub)) !== null;
  const base = { ...community, members, sharing, needed, joined };
  if (needed > 0) return { ...base, chart: [], recap: null };
  const ids = rows.map(([at]) => g.catalog.artists[at].id);
  await store.setNew(snapshotKey(community.id, day), JSON.stringify(ids), TTL);
  let recap: Recap | null = null;
  for (let back = WEEK; back < 2 * WEEK && !recap; back++) {
    const earlier = await store.get(snapshotKey(community.id, day - back));
    if (earlier) recap = recapOf(g, JSON.parse(earlier) as string[], ids);
  }
  return { ...base, chart: rows.map(([at, n]) => ({ artist: artistRef(g.catalog, at), members: n })), recap };
}
