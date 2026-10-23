import { artists, songs, genres } from './data';
import type { EntityType, GenreFilter } from './data';
import { parseProfile } from './profile';
import type { MusicProfile } from './profile';

export type Page = 'about' | 'explore';
export type Comparison = { kind: EntityType; left: string; right: string; filter?: GenreFilter };
export const examples: Record<EntityType, [string, string]> = {
  song: ['joy-division-disorder', 'radiohead-paranoid-android'],
  artist: ['joy-division', 'radiohead']
};

export function parseRoute(hash: string, fallback?: Comparison): { page: Page; comparison: Comparison; note: string; profile?: MusicProfile } {
  const raw = (hash || '#about').replace(/^#\/?/, '');
  const separator = raw.indexOf('?');
  const path = separator < 0 ? raw : raw.slice(0, separator);
  const q = new URLSearchParams(separator < 0 ? '' : raw.slice(separator + 1));
  if (path.startsWith('about')) {
    let profile: MusicProfile | null = null;
    try { profile = parseProfile(JSON.parse(q.get('profile') || 'null')); } catch { /* Invalid links open the local About Me page. */ }
    return {
      page: 'about',
      comparison: fallback || { kind: 'song', left: examples.song[0], right: examples.song[1] },
      note: profile ? (q.get('note') || '').slice(0, 300) : '',
      ...(profile ? { profile } : {})
    };
  }

  const songRoute = path === 'compare' && (q.has('songA') || q.has('songB'));
  const kind: EntityType = !songRoute && (q.get('mode') || q.get('kind')) === 'artist' ? 'artist' : 'song';
  const defaults = examples[kind];
  const catalog = kind === 'song' ? songs : artists;
  const requestedLeft = songRoute ? q.get('songA') : q.get('left');
  const requestedRight = songRoute ? q.get('songB') : q.get('right');
  const defaultLeft = requestedRight === defaults[0] ? defaults[1] : defaults[0];
  const left = catalog.some(x => x.id === requestedLeft) ? requestedLeft! : defaultLeft;
  const proposedRight = catalog.some(x => x.id === requestedRight) ? requestedRight! : defaults[1];
  const right = proposedRight !== left ? proposedRight : catalog.find(x => x.id !== left)!.id;
  const filter = genres.includes(q.get('genre') as typeof genres[number]) ? q.get('genre') as GenreFilter : 'All genres';
  return {
    page: ['explore', 'compare', 'web', 'collaborations', 'share'].includes(path) ? 'explore' : 'about',
    comparison: { kind, left, right, filter },
    note: (q.get('note') || '').slice(0, 300)
  };
}

export function buildRoute(page: Page, comparison: Comparison, note = ''): string {
  if (page === 'about') return '#about';
  const q = comparison.kind === 'song'
    ? new URLSearchParams({ songA: comparison.left, songB: comparison.right })
    : new URLSearchParams({ mode: comparison.kind, left: comparison.left, right: comparison.right });
  q.set('genre', comparison.filter || 'All genres');
  if (note) q.set('note', note.slice(0, 300));
  return `${comparison.kind === 'song' ? '#/compare' : '#explore'}?${q.toString()}`;
}

export function buildShareUrl(href: string, comparison: Comparison, note = ''): string {
  const url = new URL(href);
  url.hash = buildRoute('explore', comparison, note);
  return url.href;
}

export function buildProfileShareUrl(href: string, profile: MusicProfile, note = ''): string {
  const url = new URL(href);
  const q = new URLSearchParams({ profile: JSON.stringify(profile) });
  if (note) q.set('note', note.slice(0, 300));
  url.hash = `about?${q.toString()}`;
  return url.href;
}
