import { artists, songs, genres, subgenres } from './data';

export type MusicProfile = { artists: string[]; songs: string[]; albums: string[]; genres: string[] };
export const allGenres = [...new Set([...genres, ...Object.values(subgenres).flat()])];
// Album drawers use a song ID; retain one stable representative per album.
export const albumSongs = songs.filter((song, index) => songs.findIndex(candidate => candidate.albumId === song.albumId) === index);
const defaultArtists = ['joy-division', 'radiohead', 'bjork', 'miles-davis', 'massive-attack', 'billie-eilish'];
export const defaultProfile: MusicProfile = {
  artists: defaultArtists,
  songs: ['joy-division-disorder', 'radiohead-paranoid-android', 'bjork-hyperballad'],
  albums: albumSongs.filter(song => defaultArtists.includes(song.artistId)).map(song => song.id),
  genres: ['Post-Punk', 'Art Rock', 'Trip-Hop', 'Electronic', 'Jazz', 'Pop'].filter(genre => allGenres.includes(genre))
};
const validValues: MusicProfile = {
  artists: artists.map(artist => artist.id),
  songs: songs.map(song => song.id),
  albums: albumSongs.map(song => song.id),
  genres: allGenres
};
const categories = ['artists', 'songs', 'albums', 'genres'] as const;
function validItems(value: unknown[], category: keyof MusicProfile): string[] {
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && validValues[category].includes(item)))];
}

export function parseProfile(value: unknown): MusicProfile | null {
  if (!value || typeof value !== 'object') return null;
  const profile = value as Record<string, unknown>;
  if (!categories.every(category => Array.isArray(profile[category]))) return null;
  return Object.fromEntries(categories.map(category => [category, validItems(profile[category] as unknown[], category)])) as MusicProfile;
}

export function readStoredProfile(): MusicProfile {
  return Object.fromEntries(categories.map(category => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(`song-nexus-${category}`) || 'null');
      return [category, Array.isArray(value) ? validItems(value, category) : defaultProfile[category]];
    } catch { return [category, defaultProfile[category]]; }
  })) as MusicProfile;
}

export function storeProfile(profile: MusicProfile): void {
  for (const category of categories) {
    try { localStorage.setItem(`song-nexus-${category}`, JSON.stringify(profile[category])); }
    catch { /* In restricted browsers, session state still works. */ }
  }
}
