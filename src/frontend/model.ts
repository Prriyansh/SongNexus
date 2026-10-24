// Display helpers that turn the API's MusicBrainz shapes (src/lib/types.ts) into what the
// screens show. Nothing here fetches; nothing here invents data that the API didn't return.
import type { Artist, ArtistDetails, LinkRef, ReleaseRef, Song } from '@/lib/types';

/** A stable, muted colour per MusicBrainz id, used behind initials and missing cover art. */
export function colorFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 30% 42%)`;
}

export const yearOf = (date?: string | null) => (date && /^\d{4}/.test(date) ? date.slice(0, 4) : '');

export const capitalize = (text: string) => text.replace(/(^|[\s-])\p{L}/gu, match => match.toUpperCase());

/** MusicBrainz life-span means a birth date for people and a formation date for groups. */
export function lifeSpanLabels(type: string): { begin: string; end: string } {
  if (type === 'Person' || type === 'Character') return { begin: 'Born', end: 'Died' };
  if (type === 'Group' || type === 'Orchestra' || type === 'Choir') return { begin: 'Formed', end: 'Disbanded' };
  return { begin: 'Began', end: 'Ended' };
}

/** "Person · United States", or MusicBrainz's own disambiguation when there's nothing else. */
export function artistSubtitle(artist: Artist | ArtistDetails): string {
  const area = 'area' in artist && artist.area ? artist.area : artist.country;
  return [artist.type, area].filter(Boolean).join(' · ') || artist.disambiguation || 'Artist';
}

export const songArtists = (song: Song) => song.artists.map(artist => artist.name).join(', ') || 'Unknown artist';

/** The earliest dated release a search result lists, which is usually the original. */
export function firstRelease(song: Song): Song['releases'][number] | undefined {
  return [...song.releases].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))[0];
}

export const coverForRelease = (id?: string | null) =>
  id && /^[0-9a-f-]{36}$/i.test(id) ? `https://coverartarchive.org/release/${id}/front-250` : null;

/** Studio albums, most recent first (the API returns them oldest first). */
export const recentAlbums = (albums: ReleaseRef[]) => [...albums].reverse();

/** "18 studio albums", or "12+ studio albums" when the browse didn't cover the whole catalogue. */
export function studioAlbumText(details: ArtistDetails): string {
  const disc = details.discography;
  if (!disc) return 'Not available';
  const count = disc.studioAlbumCount;
  if (!count && disc.complete) return 'No studio albums listed';
  const plural = count === 1 && disc.complete ? 'studio album' : 'studio albums';
  return `${count}${disc.complete ? '' : '+'} ${plural}`;
}

export const ROLE_LABELS: Record<string, string> = {
  featured: 'Featured artist',
  producer: 'Producer',
  mixing: 'Mixing',
  engineering: 'Engineering',
  programming: 'Programming',
  vocals: 'Vocals',
  instruments: 'Instruments',
};
export const roleText = (roles: string[]) => roles.map(role => ROLE_LABELS[role] || capitalize(role)).join(', ');

const LINK_HOSTS: [RegExp, string][] = [
  [/spotify\.com/, 'Spotify'],
  [/music\.apple\.com|itunes\.apple\.com/, 'Apple Music'],
  [/music\.youtube\.com/, 'YouTube Music'],
  [/youtube\.com|youtu\.be/, 'YouTube'],
  [/deezer\.com/, 'Deezer'],
  [/tidal\.com/, 'Tidal'],
  [/soundcloud\.com/, 'SoundCloud'],
  [/bandcamp\.com/, 'Bandcamp'],
  [/wikidata\.org/, 'Wikidata'],
  [/discogs\.com/, 'Discogs'],
  [/allmusic\.com/, 'AllMusic'],
  [/last\.fm/, 'Last.fm'],
];
/** One link per service: MusicBrainz often lists a store under both "streaming" and "purchase". */
export function uniqueLinks(links: LinkRef[]): LinkRef[] {
  const seen = new Set<string>();
  return links.filter(link => { const label = linkLabel(link); return seen.has(label) ? false : (seen.add(label), true); });
}

export function linkLabel(link: LinkRef): string {
  const match = LINK_HOSTS.find(([pattern]) => pattern.test(link.url));
  if (match) return match[1];
  return link.type === 'official homepage' ? 'Official site' : capitalize(link.type);
}

export const musicBrainzUrl = (kind: 'artist' | 'recording' | 'release' | 'release-group', id: string) =>
  `https://musicbrainz.org/${kind}/${id}`;
