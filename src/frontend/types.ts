import type { ArtistDetails, RecordingDetails } from '@/lib/types';
import type { SavedAlbum } from './profile';

export type EntityType = 'artist' | 'song';

/** What the details drawer shows. Albums have no lookup route, so they carry their saved snapshot. */
export type Selection =
  | { type: 'artist' | 'song'; id: string }
  | { type: 'album'; id: string; album: SavedAlbum };

/** What a lookup returns for either kind. */
export type Details = ArtistDetails | RecordingDetails;

/** An artist's name or a song's title; empty while it loads. */
export const nameOf = (d?: Details) => (d ? ('title' in d ? d.title : d.name) : '');
