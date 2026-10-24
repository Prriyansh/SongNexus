import type { CSSProperties } from 'react';
import { Disc3 } from 'lucide-react';
import { artistDetails } from '../api';
import { artistCover, colorFor } from '../model';
import { useAsync } from '../useAsync';

type Size = 'sm' | 'md' | 'lg';

// Remote cover art; hides itself if the image is missing so the placeholder underneath shows.
function Cover({ url }: { url?: string | null }) {
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element -- remote cover art with an onError fallback
  return <img key={url} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 2 }} onError={event => { event.currentTarget.hidden = true; }}/>;
}

// An album cover when we have one (see artistCover); otherwise initials, never an invented portrait.
export function ArtistAvatar({ artist, size = 'md' }: { artist: { id: string; name: string; artUrl?: string | null }; size?: Size }) {
  const initials = artist.name.replace(/^The\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0]).join('').toUpperCase();
  return <span className={`artist-avatar avatar-${size}`} style={{ '--art': colorFor(artist.id) } as CSSProperties} aria-hidden="true"><span className="avatar-ring"/>{initials}<Cover url={artist.artUrl}/></span>;
}

/**
 * ArtistAvatar for places that only know an artist's id and name: loads their details (shared and
 * cached by api.ts) to find a cover. Don't use it for long lists; each new artist costs a lookup.
 */
export function ArtistPicture({ artist, size = 'md' }: { artist: { id: string; name: string; artUrl?: string | null }; size?: Size }) {
  const details = useAsync(artist.artUrl ? null : `artist:${artist.id}`, () => artistDetails(artist.id));
  const artUrl = artist.artUrl ?? (details.data ? artistCover(details.data) : null);
  return <ArtistAvatar artist={{ ...artist, artUrl }} size={size}/>;
}

// Cover Art Archive images when MusicBrainz has them; a styled disc when they're missing or broken.
export function AlbumCover({ cover, size = 'md' }: { cover: { id: string; artUrl?: string | null }; size?: Size }) {
  return <span className={`album-cover cover-${size}`} style={{ '--art': colorFor(cover.id) } as CSSProperties} aria-hidden="true">
    <Disc3 style={{ width: '42%', height: '42%' }} strokeWidth={1.25}/>
    <Cover url={cover.artUrl}/>
  </span>;
}
