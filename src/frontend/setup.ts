// First-visit setup: a few questions that fill About Me and decide where you go next.
// Saved in localStorage next to the profile, since there are no accounts yet.
import type { Artist, PlaylistSong, Song } from '@/lib/types';
import { artistSnapshot, songSnapshot } from './profile';
import type { MusicProfile } from './profile';

export type Discover = 'similar' | 'new' | 'friends';
export type TasteSetup = { done: boolean; name: string; discover: Discover | null };
/** What the setup questions collected, before it's merged into the profile. */
export type SetupAnswers = { name: string; genres: string[]; artists: Artist[]; songs: Song[]; discover: Discover | null };

const STORAGE_KEY = 'song-nexus-setup';
const DISCOVER: Discover[] = ['similar', 'new', 'friends'];
export const emptySetup: TasteSetup = { done: false, name: '', discover: null };

export function parseSetup(value: unknown): TasteSetup {
  if (!value || typeof value !== 'object') return emptySetup;
  const raw = value as Record<string, unknown>;
  return {
    done: raw.done === true,
    name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '',
    discover: DISCOVER.includes(raw.discover as Discover) ? raw.discover as Discover : null,
  };
}

export function readSetup(): TasteSetup {
  try { return parseSetup(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); } catch { return emptySetup; }
}

export function storeSetup(setup: TasteSetup): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(setup)); } catch { /* Private windows can block storage. */ }
}

const isEmpty = (profile: MusicProfile) => !profile.artists.length && !profile.songs.length && !profile.albums.length && !profile.genres.length;

/** Only on a first visit: someone who already saved music, or finished or skipped setup, isn't asked again. */
export const needsSetup = (profile: MusicProfile, setup: TasteSetup) => !setup.done && isEmpty(profile);

/** Adds the answers to the profile, keeping everything already there. */
export function applyAnswers(profile: MusicProfile, answers: SetupAnswers): MusicProfile {
  const artists = answers.artists.map(artistSnapshot).filter(a => !profile.artists.some(x => x.id === a.id));
  const songs = answers.songs.map(songSnapshot).filter(s => !profile.songs.some(x => x.id === s.id));
  return {
    ...profile,
    artists: [...profile.artists, ...artists],
    songs: [...profile.songs, ...songs],
    genres: [...new Set([...profile.genres, ...answers.genres])],
  };
}

/** Saved songs as a playlist, for the My playlist map ("New to you"). */
export const playlistFrom = (profile: MusicProfile): PlaylistSong[] =>
  profile.songs.map(s => ({ title: s.title.trim(), artist: s.artist.trim() })).filter(s => s.title && s.artist);
