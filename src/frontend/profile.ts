// About Me preferences. There's no account backend yet, so the profile lives in localStorage.
// Each favourite is a small snapshot (id + display fields) so the page can render without
// re-fetching every item, and a shared profile link can be shown to someone else as-is.
import type { Artist, ReleaseRef, Song } from '@/lib/types';
import { artistSubtitle, coverForRelease, firstRelease, songArtists, yearOf } from './model';
import { formatDuration } from '@/lib/types';

export type SavedArtist = { id: string; name: string; subtitle: string };
export type SavedSong = { id: string; title: string; artist: string; artistId: string | null; album: string; year: string; duration: string; artUrl: string | null };
export type SavedAlbum = { id: string; title: string; artist: string; artistId: string | null; year: string; artUrl: string | null };
export type MusicProfile = { artists: SavedArtist[]; songs: SavedSong[]; albums: SavedAlbum[]; genres: string[] };

export const emptyProfile: MusicProfile = { artists: [], songs: [], albums: [], genres: [] };

export function artistSnapshot(artist: Artist): SavedArtist {
  return { id: artist.id, name: artist.name, subtitle: artistSubtitle(artist) };
}

export function songSnapshot(song: Song): SavedSong {
  const release = firstRelease(song);
  return {
    id: song.id,
    title: song.title,
    artist: songArtists(song),
    artistId: song.artists[0]?.id ?? null,
    album: release?.title ?? '',
    year: yearOf(release?.date),
    duration: song.durationMs == null ? '—' : formatDuration(song.durationMs),
    artUrl: coverForRelease(release?.id),
  };
}

/** A studio album from an artist's discography (a MusicBrainz release-group). */
export function albumSnapshot(album: ReleaseRef, artist: { id: string; name: string }): SavedAlbum {
  return { id: album.id, title: album.title, artist: artist.name, artistId: artist.id, year: album.year, artUrl: album.artUrl };
}

// --- Validation: stored and shared profiles are untrusted input -----------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 100;
const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '');
const id = (value: unknown) => (typeof value === 'string' && UUID.test(value) ? value : null);
// Only Cover Art Archive images, so a shared link can't make the page load arbitrary URLs.
const art = (value: unknown) => (typeof value === 'string' && value.startsWith('https://coverartarchive.org/') ? value : null);
const record = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

function list<T extends { id: string }>(value: unknown, read: (item: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const raw of value) {
    const item = read(record(raw));
    if (item && !seen.has(item.id)) { seen.add(item.id); out.push(item); }
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export function parseProfile(value: unknown): MusicProfile | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!['artists', 'songs', 'albums', 'genres'].every(key => Array.isArray(raw[key]))) return null;
  return {
    artists: list(raw.artists, item => {
      const key = id(item.id), name = text(item.name);
      return key && name ? { id: key, name, subtitle: text(item.subtitle) } : null;
    }),
    songs: list(raw.songs, item => {
      const key = id(item.id), title = text(item.title);
      return key && title ? { id: key, title, artist: text(item.artist), artistId: id(item.artistId), album: text(item.album), year: text(item.year, 4), duration: text(item.duration, 8) || '—', artUrl: art(item.artUrl) } : null;
    }),
    albums: list(raw.albums, item => {
      const key = id(item.id), title = text(item.title);
      return key && title ? { id: key, title, artist: text(item.artist), artistId: id(item.artistId), year: text(item.year, 4), artUrl: art(item.artUrl) } : null;
    }),
    genres: [...new Set((raw.genres as unknown[]).map(g => text(g, 60).trim()).filter(Boolean))].slice(0, MAX_ITEMS),
  };
}

const STORAGE_KEY = 'song-nexus-profile';

export function readStoredProfile(): MusicProfile {
  try {
    return parseProfile(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')) ?? emptyProfile;
  } catch {
    return emptyProfile;
  }
}

export function storeProfile(profile: MusicProfile): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); }
  catch { /* Private windows can block storage; the session still works. */ }
}
