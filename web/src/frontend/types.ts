import type { SavedAlbum } from './profile';

export type EntityType = 'artist' | 'song';

/** What the details drawer shows. Albums have no lookup route, so they carry their saved snapshot. */
export type Selection =
  | { type: 'artist' | 'song'; id: string }
  | { type: 'album'; id: string; album: SavedAlbum };
