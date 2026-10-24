import type { CSSProperties } from 'react';
import { Disc3 } from 'lucide-react';
import { colorFor } from '../model';

// Initials are a neutral placeholder, rather than an invented artist portrait.
export function ArtistAvatar({ artist, size = 'md' }: { artist: { id: string; name: string }; size?: 'sm' | 'md' | 'lg' }) {
  const initials = artist.name.replace(/^The\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0]).join('').toUpperCase();
  return <span className={`artist-avatar avatar-${size}`} style={{ '--art': colorFor(artist.id) } as CSSProperties} aria-hidden="true"><span className="avatar-ring"/>{initials}</span>;
}

// Cover Art Archive images when MusicBrainz has them; a styled disc when they're missing or broken.
export function AlbumCover({ cover, size = 'md' }: { cover: { id: string; artUrl?: string | null }; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`album-cover cover-${size}`} style={{ '--art': colorFor(cover.id) } as CSSProperties} aria-hidden="true">
    <Disc3 style={{ width: '42%', height: '42%' }} strokeWidth={1.25}/>
    {/* eslint-disable-next-line @next/next/no-img-element -- remote cover art with an onError fallback */}
    {cover.artUrl && <img key={cover.artUrl} src={cover.artUrl} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 2 }} onError={event => { event.currentTarget.hidden = true; }}/>}
  </span>;
}
