// Songs from the sound dataset are known by title and artist (and a Spotify id); the rest of
// the app uses MusicBrainz recordings. This finds the MusicBrainz recording for such a song.
import type { Song } from '@/lib/types';
import { searchSongs } from './api';
import { firstRelease } from './model';
import { matchQuery, pickMatch } from './playlist';

/**
 * The MusicBrainz recording of a song named in the dataset, or null. Several recordings often
 * share a title (live versions, remixes, compilations); the one with the earliest dated
 * official release is usually the original.
 */
export async function findRecording(title: string, artist: string, signal?: AbortSignal): Promise<Song | null> {
  const row = { title, artist };
  const results = await searchSongs(`${matchQuery(row)} AND status:official`, signal, 15);
  const matches = results.filter(song => pickMatch(row, [song]));
  const releaseDate = (song: Song) => firstRelease(song)?.date || '9999';
  return matches.sort((x, y) => releaseDate(x).localeCompare(releaseDate(y)))[0] ?? null;
}
