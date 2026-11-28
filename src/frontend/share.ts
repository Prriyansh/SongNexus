// What the Share button shares from each page: which music it names, and the link it copies.
import type { MusicProfile } from './profile';
import { buildPath, buildProfileShareUrl, buildShareUrl, defaultWeb } from './routing';
import type { Route } from './routing';
import type { EntityType } from './types';

/**
 * - `profile`: About Me, as a snapshot carried in the link.
 * - `taste`: a playlist map (Friends, or the Connection Web's My playlist); it names no music.
 * - `web`: the Connection Web around one artist or song, or a pair in its Comparison mode.
 * - `comparison`: Explore's two artists or songs.
 */
export type ShareSubject =
  | { what: 'profile' }
  | { what: 'taste'; friends: boolean }
  | { what: 'web'; kind: EntityType; ids: [string] | [string, string] }
  | { what: 'comparison'; kind: EntityType; ids: [string, string] };

export function shareSubject(route: Route): ShareSubject {
  if (route.page === 'about') return { what: 'profile' };
  if (route.page === 'friends') return { what: 'taste', friends: true };
  if (route.page === 'connections') {
    const web = route.web ?? defaultWeb();
    if (web.mode === 'playlist') return { what: 'taste', friends: false };
    if (web.mode === 'song') return { what: 'web', kind: 'song', ids: [web.song] };
    if (web.mode === 'comparison') return { what: 'web', kind: 'artist', ids: [web.left, web.right] };
    return { what: 'web', kind: 'artist', ids: [web.artist] };
  }
  const { kind, left, right } = route.comparison;
  return { what: 'comparison', kind, ids: [left, right] };
}

/** The line under the heading naming what's shared; `names` are the music's names as they load. */
export function shareLabel(subject: ShareSubject, profile: MusicProfile, names: string[]): string {
  const name = (i: number) => names[i] || '…';
  switch (subject.what) {
    case 'profile':
      return `${profile.artists.length} artists · ${profile.genres.length} genres · ${profile.albums.length} albums · ${profile.songs.length} songs`;
    case 'taste':
      return subject.friends ? 'Friends' : 'Connection Web';
    case 'web':
      return subject.ids.length === 2 ? `${name(0)} ↔ ${name(1)} · Connection Web` : `${name(0)} · Connection Web`;
    case 'comparison':
      return `${name(0)} ↔ ${name(1)}`;
  }
}

/**
 * The link to copy. Friends links are the page's own address, since it carries the room code or
 * playlist; Connection Web links keep the hash, which holds a friend's playlist.
 */
export function shareUrl(route: Route, profile: MusicProfile, note: string, location: Pick<Location, 'origin' | 'href' | 'hash'>): string {
  if (route.page === 'about') return buildProfileShareUrl(location.origin, profile, note);
  if (route.page === 'friends') return location.href;
  if (route.page === 'connections') {
    return new URL(buildPath('connections', route.comparison, note, false, route.web ?? defaultWeb()) + location.hash, location.origin).href;
  }
  return buildShareUrl(location.origin, route.comparison, note);
}
