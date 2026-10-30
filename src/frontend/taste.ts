// Playlists on the Connection Web: keeping yours in this browser, packing one into a link or code,
// and laying out the map. A link's playlist sits after the #, which browsers never send to a server.
import type { PlaylistSong, TasteLink, TasteMap, TasteNode } from '@/lib/types';
import type { WebEdge, WebNode } from './similar-web';
import { WEB_CARD } from './similar-web';

const STORAGE_KEY = 'song-nexus-playlist';
const MAX_ROWS = 250;
const MAX_TEXT = 200;
const MAX_NAME = 30;

export type SharedPlaylist = { name: string; songs: PlaylistSong[] };

const clean = (value: unknown): SharedPlaylist | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { n?: unknown; name?: unknown; r?: unknown; songs?: unknown };
  const rows: unknown = raw.r ?? raw.songs;
  if (!Array.isArray(rows)) return null;
  const songs = rows.slice(0, MAX_ROWS).flatMap((row: unknown) => {
    const [title, artist] = Array.isArray(row) ? row : [(row as PlaylistSong)?.title, (row as PlaylistSong)?.artist];
    return typeof title === 'string' && title && typeof artist === 'string' && artist ? [{ title: title.slice(0, MAX_TEXT), artist: artist.slice(0, MAX_TEXT) }] : [];
  });
  const name = raw.n ?? raw.name;
  return songs.length ? { name: typeof name === 'string' ? name.slice(0, MAX_NAME) : '', songs } : null;
};

export function readStoredPlaylist(): SharedPlaylist | null {
  try { return clean(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); } catch { return null; }
}
export function storePlaylist(playlist: SharedPlaylist | null) {
  try { if (playlist) localStorage.setItem(STORAGE_KEY, JSON.stringify(playlist)); else localStorage.removeItem(STORAGE_KEY); }
  catch { /* Private windows can block storage; the session still works. */ }
}

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const through = async (stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> }, data: Uint8Array) => {
  const writer = stream.writable.getWriter();
  void writer.write(data as BufferSource).then(() => writer.close()).catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
};

/** Packs a playlist into text that fits in a link: a short code needs a server to look it up, and this doesn't. */
export async function encodePlaylist(playlist: SharedPlaylist): Promise<string> {
  const json = JSON.stringify({ n: playlist.name, r: playlist.songs.map(s => [s.title, s.artist]) });
  const packed = await through(new CompressionStream('deflate-raw') as never, new TextEncoder().encode(json));
  return toBase64Url(packed);
}

/** Null for anything that isn't a valid playlist: these arrive from links, so they aren't trusted. */
export async function decodePlaylist(code: string): Promise<SharedPlaylist | null> {
  try {
    const bytes = await through(new DecompressionStream('deflate-raw') as never, fromBase64Url(code.trim()));
    return clean(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export const friendLink = (origin: string, a: string, b?: string) => `${origin}/friends#${new URLSearchParams({ a, ...(b ? { b } : {}) })}`;

export const TASTE_WORLD_WIDTH = 1200;

/** Where each kind of node sits, left (you) to right (your friend), as a share of the width. */
const BANDS: Record<TasteNode['group'], [number, number]> = {
  mine: [.03, .24], 'for-them': [.24, .36], shared: [.42, .58], new: [.36, .64], 'for-me': [.64, .76], theirs: [.76, .97],
};
const NO_FRIEND_BANDS: Partial<Record<TasteNode['group'], [number, number]>> = { mine: [.03, .55], new: [.6, .97] };

const seedOf = (id: string) => {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
};

/** Deterministic: the same playlists always make the same map. Goes taller than the view when it has to. */
export function layoutTaste(map: TasteMap, width: number, height: number, hasFriend: boolean): WebNode[] {
  const worldWidth = Math.max(width, hasFriend ? TASTE_WORLD_WIDTH : 900);
  const placed: WebNode[] = [];
  const ordered = [...map.nodes].sort((a, b) => Number(a.kind === 'song') - Number(b.kind === 'song') || b.weight - a.weight || a.id.localeCompare(b.id));
  const free = (x: number, y: number) => placed.every(p => ((p.x - x) / WEB_CARD.width) ** 2 + ((p.y - y) / WEB_CARD.height) ** 2 >= 1);
  ordered.forEach((node, rank) => {
    const [from, to] = (hasFriend ? BANDS : { ...BANDS, ...NO_FRIEND_BANDS })[node.group];
    const seed = seedOf(node.id);
    const startX = (from + (to - from) * seed) * worldWidth;
    let spot = { x: startX, y: height / 2 };
    search: for (let row = 0; row < 40; row++) {
      for (const side of [1, -1]) {
        const y = height / 2 + side * row * WEB_CARD.height * .9;
        for (let step = 0; step < 12; step++) {
          const x = (from + (to - from) * ((seed + step * .381966) % 1)) * worldWidth;
          if (free(x, y)) { spot = { x, y }; break search; }
        }
      }
    }
    placed.push({ kind: node.kind, id: node.id, name: node.name, subtitle: node.subtitle, artist: node.artist, imageUrl: node.imageUrl, similarity: 1, rank, listeners: null, reasons: node.reasons, ...spot, isCenter: false, group: node.group });
  });
  return placed;
}

export const tasteEdges = (links: TasteLink[]): WebEdge[] => links.map(link => ({ from: link.from, to: link.to, kind: link.kind, strength: 1 }));

export function tasteNear(id: string, map: TasteMap): string[] {
  const names = new Map(map.nodes.map(n => [n.id, n.name]));
  return [...new Set(map.links.flatMap(l => l.from === id ? [l.to] : l.to === id ? [l.from] : []))].flatMap(other => names.get(other) ?? []);
}

export const SAMPLE_MINE: SharedPlaylist = { name: 'You', songs: [
  ['vampire', 'Olivia Rodrigo'], ['good 4 u', 'Olivia Rodrigo'], ['Anti-Hero', 'Taylor Swift'], ['cardigan', 'Taylor Swift'], ['Kill Bill', 'SZA'], ['Good Days', 'SZA'],
  ['Espresso', 'Sabrina Carpenter'], ['bad guy', 'Billie Eilish'], ['Levitating', 'Dua Lipa'], ['Motion Sickness', 'Phoebe Bridgers'], ['Royals', 'Lorde'], ['As It Was', 'Harry Styles'],
].map(([title, artist]) => ({ title, artist })) };
export const SAMPLE_FRIEND: SharedPlaylist = { name: 'Sam', songs: [
  ['HUMBLE.', 'Kendrick Lamar'], ['Money Trees', 'Kendrick Lamar'], ['Kill Bill', 'SZA'], ['Snooze', 'SZA'], ['Blinding Lights', 'The Weeknd'], ['Save Your Tears', 'The Weeknd'],
  ['Pink + White', 'Frank Ocean'], ['Nights', 'Frank Ocean'], ['Anti-Hero', 'Taylor Swift'], ['Heat Waves', 'Glass Animals'], ['See You Again', 'Tyler, The Creator'], ['Get Lucky', 'Daft Punk'],
].map(([title, artist]) => ({ title, artist })) };
