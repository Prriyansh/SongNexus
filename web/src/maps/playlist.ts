/**
 * Playlists for the maps: read from pasted "Title - Artist" lines or a CSV, JSON or TXT file,
 * on this device. Only titles and artist names are kept; rows without an artist can't be placed
 * on a map, so they are dropped and counted. Ported from the team app's Friends playlists.
 */
import type {Schemas} from '../api/client';

export type Track = Schemas['PlaylistTrack-Input'];

export const MAX_TRACKS = 250;
const MAX_TEXT = 200;
export const MAX_FILE_BYTES = 2_000_000;

export interface Parsed {
  tracks: Track[];
  skipped: number;
}

function track(title: unknown, artist: unknown): Track | null {
  const t = typeof title === 'string' ? title.trim().slice(0, MAX_TEXT) : '';
  const a = typeof artist === 'string' ? artist.trim().slice(0, MAX_TEXT) : '';
  return a ? {title: t, artists: [a]} : null;
}

/** "Title - Artist" (also en and em dashes); a line without a dash has no artist. */
function fromLines(text: string): Parsed {
  const tracks: Track[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;
    const match = /^(.*\S)\s+[-–—]\s+(\S.*)$/.exec(row);
    const parsed = match ? track(match[1], match[2]) : null;
    if (parsed) tracks.push(parsed);
    else skipped += 1;
  }
  return {tracks, skipped};
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else cell += c;
  }
  cells.push(cell);
  return cells;
}

function fromCsv(text: string): Parsed | null {
  const [head, ...rows] = text.split(/\r?\n/).filter(l => l.trim());
  if (!head) return null;
  const columns = splitCsv(head).map(c => c.trim().toLowerCase());
  const titleAt = columns.findIndex(c =>
    /^(track name|title|song|track|name)$/.test(c),
  );
  const artistAt = columns.findIndex(c => /artist/.test(c));
  if (artistAt < 0) return null;
  const tracks: Track[] = [];
  let skipped = 0;
  for (const row of rows) {
    const cells = splitCsv(row);
    const parsed = track(
      titleAt >= 0 ? cells[titleAt] : '',
      cells[artistAt]?.split(/;\s*/)[0],
    );
    if (parsed) tracks.push(parsed);
    else skipped += 1;
  }
  return {tracks, skipped};
}

function fromJson(text: string): Parsed | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const rows = Array.isArray(value)
    ? value
    : Array.isArray((value as {tracks?: unknown})?.tracks)
      ? (value as {tracks: unknown[]}).tracks
      : null;
  if (!rows) return null;
  const tracks: Track[] = [];
  let skipped = 0;
  for (const row of rows) {
    const r = (row ?? {}) as Record<string, unknown>;
    const artist = Array.isArray(r.artists)
      ? r.artists[0]
      : (r.artist ?? r.artistName);
    const parsed = track(r.title ?? r.name ?? r.trackName, artist);
    if (parsed) tracks.push(parsed);
    else skipped += 1;
  }
  return {tracks, skipped};
}

/** Reads a playlist; the file name picks the format, pasted text is lines. */
export function parsePlaylist(fileName: string, text: string): Parsed {
  const lower = fileName.toLowerCase();
  const parsed =
    (lower.endsWith('.json') && fromJson(text)) ||
    (lower.endsWith('.csv') && fromCsv(text)) ||
    fromLines(text);
  return {
    tracks: parsed.tracks.slice(0, MAX_TRACKS),
    skipped: parsed.skipped + Math.max(0, parsed.tracks.length - MAX_TRACKS),
  };
}

/** Tracks back to editable lines. */
export const toLines = (tracks: readonly Track[]) =>
  tracks.map(t => `${t.title} - ${t.artists.join(', ')}`).join('\n');

const KEY = 'songnexus.playlist.v1';

/** Your playlist for the maps, kept in this browser only. */
export function readStoredPlaylist(): Track[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!Array.isArray(raw)) return [];
    return raw
      .map(r => track((r as Track)?.title, (r as Track)?.artists?.[0]))
      .filter((t): t is Track => t !== null)
      .slice(0, MAX_TRACKS);
  } catch {
    return [];
  }
}

export function storePlaylist(tracks: readonly Track[]): void {
  try {
    if (tracks.length) localStorage.setItem(KEY, JSON.stringify(tracks));
    else localStorage.removeItem(KEY);
  } catch {
    // Private windows can block storage; the map still works for this visit.
  }
}

/** Sample playlists, so the map can be tried without a file. */
export const SAMPLE_MINE: Track[] = [
  ['vampire', 'Olivia Rodrigo'],
  ['good 4 u', 'Olivia Rodrigo'],
  ['Anti-Hero', 'Taylor Swift'],
  ['cardigan', 'Taylor Swift'],
  ['Kill Bill', 'SZA'],
  ['Good Days', 'SZA'],
  ['Espresso', 'Sabrina Carpenter'],
  ['bad guy', 'Billie Eilish'],
  ['Levitating', 'Dua Lipa'],
  ['Motion Sickness', 'Phoebe Bridgers'],
  ['Royals', 'Lorde'],
  ['As It Was', 'Harry Styles'],
].map(([title, artist]) => ({title: title!, artists: [artist!]}));

export const SAMPLE_FRIEND: Track[] = [
  ['HUMBLE.', 'Kendrick Lamar'],
  ['Money Trees', 'Kendrick Lamar'],
  ['Kill Bill', 'SZA'],
  ['Snooze', 'SZA'],
  ['Blinding Lights', 'The Weeknd'],
  ['Save Your Tears', 'The Weeknd'],
  ['Pink + White', 'Frank Ocean'],
  ['Nights', 'Frank Ocean'],
  ['Anti-Hero', 'Taylor Swift'],
  ['Heat Waves', 'Glass Animals'],
  ['See You Again', 'Tyler, The Creator'],
  ['Get Lucky', 'Daft Punk'],
].map(([title, artist]) => ({title: title!, artists: [artist!]}));
