/**
 * The rest of the first-visit questions (Lakadia's setup): what to call you, songs you love,
 * and how you like to find new music. Kept in this browser beside the Personalize picks
 * (`picks.ts`); the songs leave this device only when you put them on a map.
 */
import {useSyncExternalStore} from 'react';

import type {Track} from '../maps/playlist';

const KEY = 'songnexus.setup.v1';
export const MAX_SONGS = 20;
const MAX_NAME = 40;

/** Where a first visit leads: what's like your music, something new, or your friends. */
export type Discover = 'similar' | 'new' | 'friends';
export const DISCOVER: readonly Discover[] = ['similar', 'new', 'friends'];

export type SavedSong = {name: string; title: string; artist: string};

export type Setup = {
  name: string;
  songs: SavedSong[];
  discover: Discover | null;
};
export const EMPTY_SETUP: Setup = {name: '', songs: [], discover: null};

const RECORDING = /^recordings\/[\w-]+$/;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** A stored value, checked field by field; anything unexpected is dropped. */
export function parseSetup(raw: unknown): Setup {
  if (!raw || typeof raw !== 'object') return EMPTY_SETUP;
  const value = raw as Record<string, unknown>;
  const songs = (Array.isArray(value.songs) ? value.songs : [])
    .map((s: unknown) => {
      const song = (s ?? {}) as Record<string, unknown>;
      const name = text(song.name, 120);
      const title = text(song.title, 300);
      const artist = text(song.artist, 300);
      return RECORDING.test(name) && title && artist
        ? {name, title, artist}
        : null;
    })
    .filter((s): s is SavedSong => s !== null);
  return {
    name: text(value.name, MAX_NAME),
    songs: [...new Map(songs.map(s => [s.name, s])).values()].slice(
      0,
      MAX_SONGS,
    ),
    discover: DISCOVER.includes(value.discover as Discover)
      ? (value.discover as Discover)
      : null,
  };
}

const listeners = new Set<() => void>();
let cached: {raw: string | null; setup: Setup} | null = null;

export function readSetup(): Setup {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (cached && cached.raw === raw) return cached.setup;
  let setup = EMPTY_SETUP;
  try {
    setup = raw ? parseSetup(JSON.parse(raw)) : EMPTY_SETUP;
  } catch {
    setup = EMPTY_SETUP;
  }
  cached = {raw, setup};
  return setup;
}

export function saveSetup(setup: Setup): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(parseSetup(setup)));
  } catch {
    // Full or blocked storage: nothing to keep, nothing to break.
  }
  listeners.forEach(listener => listener());
}

export function clearSetup(): void {
  try {
    localStorage.removeItem(KEY);
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

export function useSetup(): Setup {
  return useSyncExternalStore(subscribe, readSetup, () => EMPTY_SETUP);
}

/** Saved songs as a playlist, for the maps ("Use my saved songs"). */
export function useSavedSongs(): Track[] {
  const {songs} = useSetup();
  return songs.map(s => ({title: s.title, artists: [s.artist]}));
}

/** Where to go after setup, from the discovery answer. */
export function nextStop(discover: Discover | null): string {
  if (discover === 'similar') return '/map?mode=playlist';
  if (discover === 'friends') return '/map?mode=friend';
  return '/';
}
