/**
 * What a listener told SongNexus on the Personalize page: genres they like and artists they
 * love. Kept in this browser (and, when signed in, the artists are also followed on the
 * server). The For you shelf uses the artists as seeds for a feed preview when signed out.
 */
import {useSyncExternalStore} from 'react';

const KEY = 'songnexus.picks.v1';
export const MAX_GENRES = 8;
export const MAX_ARTISTS = 20;

export type PickedGenre = {name: string; displayName: string};
export type PickedArtist = {
  name: string;
  displayName: string;
  imageUrl: string | null;
};

export type Picks = {
  genres: PickedGenre[];
  artists: PickedArtist[];
  /** Saved, or skipped: either way Home stops offering the page. */
  done: boolean;
};

export const EMPTY: Picks = {genres: [], artists: [], done: false};

const GENRE = /^genres\/[\w-]+$/;
const ARTIST = /^artists\/[\w-]+$/;

function text(value: unknown, max = 300): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

/** A stored value, validated field by field; anything unexpected is dropped. */
export function parsePicks(raw: unknown): Picks {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const value = raw as Record<string, unknown>;
  const genres = (Array.isArray(value.genres) ? value.genres : [])
    .map((g: unknown) => {
      const genre = g as Record<string, unknown> | null;
      const name = text(genre?.name);
      const displayName = text(genre?.displayName);
      return name && displayName && GENRE.test(name)
        ? {name, displayName}
        : null;
    })
    .filter((g): g is PickedGenre => g !== null);
  const artists = (Array.isArray(value.artists) ? value.artists : [])
    .map((a: unknown) => {
      const artist = a as Record<string, unknown> | null;
      const name = text(artist?.name);
      const displayName = text(artist?.displayName);
      const image = text(artist?.imageUrl, 2048);
      return name && displayName && ARTIST.test(name)
        ? {
            name,
            displayName,
            imageUrl: image && image.startsWith('https://') ? image : null,
          }
        : null;
    })
    .filter((a): a is PickedArtist => a !== null);
  return {
    genres: unique(genres).slice(0, MAX_GENRES),
    artists: unique(artists).slice(0, MAX_ARTISTS),
    done: value.done === true,
  };
}

function unique<T extends {name: string}>(items: T[]): T[] {
  return [...new Map(items.map(item => [item.name, item])).values()];
}

const listeners = new Set<() => void>();
let cached: {raw: string | null; picks: Picks} | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // blocked storage (privacy settings): the page still works for this visit
  }
}

export function readPicks(): Picks {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(KEY) ?? null;
  } catch {
    raw = null;
  }
  if (cached && cached.raw === raw) return cached.picks;
  let picks = EMPTY;
  try {
    picks = raw ? parsePicks(JSON.parse(raw)) : EMPTY;
  } catch {
    picks = EMPTY;
  }
  cached = {raw, picks};
  return picks;
}

export function savePicks(picks: Picks): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(parsePicks(picks)));
  } catch {
    // Full or blocked storage: nothing to keep, nothing to break.
  }
  listeners.forEach(listener => listener());
}

/** Clears everything picked (the Personalize page's "Start over"). */
export function clearPicks(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The current picks, updated when they change (here or in another tab). */
export function usePicks(): Picks {
  return useSyncExternalStore(subscribe, readPicks, () => EMPTY);
}
