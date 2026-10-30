// URL scheme. Comparisons keep the shareable links main already used:
//   /compare/artists?artistA=<mbid>&artistB=<mbid>   /compare/songs?songA=<mbid>&songB=<mbid>
// plus /about, /about/manual and /about?profile=… for a shared About Me snapshot.
import type { EntityType } from './types';
import { parseProfile } from './profile';
import type { MusicProfile } from './profile';

export type Page = 'about' | 'connections' | 'explore';
export type WebSelection = { mode: 'comparison' | 'search'; left: string; right: string; song: string };
export type Comparison = { kind: EntityType; left: string; right: string; role?: string };
export type Route = { page: Page; manual: boolean; comparison: Comparison; note: string; profile?: MusicProfile; web?: WebSelection };

// Defaults: Olivia Rodrigo and Taylor Swift share credits on MusicBrainz (both mixed by Serban
// Ghenea), and both songs are in the sound & lyrics dataset, so every section has data.
export const examples: Record<EntityType, [string, string]> = {
  artist: ['6925db17-f35e-42f3-a4eb-84ee6bf5d4b0', '20244d07-534f-4eff-b4d4-930878889970'], // Olivia Rodrigo, Taylor Swift
  song: ['143f1c88-f47f-4f37-b25d-614c74269dea', 'c3fe7791-0a91-4f0a-a89b-b056f38d3cde'], // drivers license, Blank Space
};

export const ROLE_FILTERS = ['all', 'producer', 'featured', 'mixing', 'engineering', 'vocals', 'instruments', 'programming'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARAMS: Record<EntityType, [string, string]> = { artist: ['artistA', 'artistB'], song: ['songA', 'songB'] };
const note = (q: URLSearchParams) => (q.get('note') || '').slice(0, 300);

export const defaultWeb = (): WebSelection => ({ mode: 'comparison', left: examples.artist[0], right: examples.artist[1], song: examples.song[0] });

/** A valid, distinct pair: unknown ids fall back to the defaults. */
export function comparisonFor(kind: EntityType, left?: string | null, right?: string | null, role?: string | null): Comparison {
  const [d1, d2] = examples[kind];
  const a = left && UUID.test(left) ? left.toLowerCase() : null;
  const b = right && UUID.test(right) ? right.toLowerCase() : null;
  const first = a ?? (b === d1 ? d2 : d1);
  const second = b && b !== first ? b : first === d2 ? d1 : d2;
  return { kind, left: first, right: second, role: role && ROLE_FILTERS.includes(role) ? role : 'all' };
}

export function parseRoute(pathname: string, search: string, fallback?: Comparison): Route {
  const q = new URLSearchParams(search);
  const path = pathname.replace(/\/+$/, '') || '/';
  const compare = path.match(/^\/compare\/(artists|songs)$/);
  if (path === '/connections') {
    const pair = comparisonFor('artist', q.get('artistA'), q.get('artistB'));
    const song = q.get('song');
    return { page: 'connections', manual: false, comparison: fallback ?? comparisonFor('artist'), note: note(q),
      web: { mode: q.get('mode') === 'search' ? 'search' : 'comparison', left: pair.left, right: pair.right,
        song: song && UUID.test(song) ? song.toLowerCase() : examples.song[0] } };
  }
  if (compare) {
    const kind: EntityType = compare[1] === 'artists' ? 'artist' : 'song';
    const [pa, pb] = PARAMS[kind];
    return { page: 'explore', manual: false, comparison: comparisonFor(kind, q.get(pa), q.get(pb), q.get('role')), note: note(q) };
  }
  let profile: MusicProfile | null = null;
  try { profile = parseProfile(JSON.parse(q.get('profile') || 'null')); } catch { /* A broken link opens your own About Me. */ }
  return {
    page: 'about',
    manual: path === '/about/manual',
    comparison: fallback ?? comparisonFor('artist'),
    note: profile ? note(q) : '',
    ...(profile ? { profile } : {}),
  };
}

export function buildPath(page: Page, comparison: Comparison, noteText = '', manual = false, web = defaultWeb()): string {
  if (page === 'about') return manual ? '/about/manual' : '/about';
  if (page === 'connections') {
    const q = new URLSearchParams({ mode: web.mode, artistA: web.left, artistB: web.right, song: web.song });
    if (noteText) q.set('note', noteText.slice(0, 300));
    return `/connections?${q}`;
  }
  const [pa, pb] = PARAMS[comparison.kind];
  const q = new URLSearchParams({ [pa]: comparison.left, [pb]: comparison.right });
  if (comparison.role && comparison.role !== 'all') q.set('role', comparison.role);
  if (noteText) q.set('note', noteText.slice(0, 300));
  return `/compare/${comparison.kind === 'artist' ? 'artists' : 'songs'}?${q.toString()}`;
}

export const buildShareUrl = (origin: string, comparison: Comparison, noteText = '') =>
  new URL(buildPath('explore', comparison, noteText), origin).href;

export function buildProfileShareUrl(origin: string, profile: MusicProfile, noteText = ''): string {
  const q = new URLSearchParams({ profile: JSON.stringify(profile) });
  if (noteText) q.set('note', noteText.slice(0, 300));
  return new URL(`/about?${q.toString()}`, origin).href;
}
