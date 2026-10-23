import type { CSSProperties } from 'react';
import { Disc3 } from 'lucide-react';
import type { Artist, Song } from '../data';

// Initials are a neutral placeholder, rather than an invented artist portrait.
export function ArtistAvatar({ artist, size = 'md' }: { artist: Artist; size?: 'sm' | 'md' | 'lg' }) {
  const initials = artist.name.replace(/^The\s+/i, '').split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return <span className={`artist-avatar avatar-${size}`} style={{ '--art': artist.color } as CSSProperties} aria-hidden="true"><span className="avatar-ring"/>{initials}</span>;
}

export function AlbumCover({ song, size = 'md' }: { song: Song; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`album-cover cover-${size}`} style={{ '--art': song.color } as CSSProperties} aria-hidden="true">
    <Disc3 style={{ width: '42%', height: '42%' }} strokeWidth={1.25}/>
    {song.artworkUrl && <img key={song.artworkUrl} src={song.artworkUrl} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 2 }} onError={event => { event.currentTarget.hidden = true; }}/>}
  </span>;
}
