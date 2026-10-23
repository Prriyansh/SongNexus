import { songs, getArtist, recordingArtistIds } from './data';
import type { Song } from './data';

export interface PlaylistRow { title: string; artist: string }
const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

// Preserve empty cells, escaped quotes, commas and newlines inside quoted CSV cells.
export function readCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ',') { row.push(cell.trim()); cell = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('The CSV has an unclosed quote. Check the file and try again.');
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
const textRow = (line: string): PlaylistRow => {
  const [title, ...artist] = line.split(/\s+[—–-]\s+/);
  return { title: title.trim(), artist: artist.join(' — ').trim() };
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown) => typeof v === 'string' ? v : '';

export function parsePlaylist(name: string, text: string): PlaylistRow[] {
  let rows: PlaylistRow[];
  if (/\.csv$/i.test(name)) {
    const [header, ...data] = readCsv(text.replace(/^\uFEFF/, ''));
    if (!header) throw new Error('The playlist file is empty.');
    const keys = header.map(s => s.toLowerCase());
    const ti = keys.findIndex(s => ['track name', 'title', 'song', 'name', 'track'].includes(s));
    const ai = keys.findIndex(s => ['artist name', 'artist', 'artists'].includes(s));
    if (ti < 0) throw new Error('CSV files need a Title or Track Name column. Artist is optional.');
    rows = data.map(c => ({ title: c[ti] || '', artist: ai < 0 ? '' : c[ai] || '' }));
  } else if (/\.json$/i.test(name)) {
    const value: unknown = JSON.parse(text);
    const obj = record(value);
    const list: unknown = Array.isArray(value) ? value : obj.tracks || obj.songs || obj.items;
    if (!Array.isArray(list)) throw new Error('JSON must be a track array, or an object with a tracks, songs, or items array.');
    rows = list.map(item => {
      if (typeof item === 'string') return textRow(item);
      const outer = record(item), track = outer.track ? record(outer.track) : outer;
      const names = Array.isArray(track.artists) ? track.artists.map(a => typeof a === 'string' ? a : string(record(a).name)).filter(Boolean).join(', ') : '';
      return { title: string(track.title) || string(track.name), artist: string(track.artist) || names };
    });
  } else {
    rows = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(textRow);
  }
  rows = rows.filter(r => r.title);
  if (rows.length > 250) throw new Error('This demo supports up to 250 tracks per file. Please split your playlist.');
  if (!rows.length) throw new Error('No track titles found. Try the sample playlist or check your file.');
  return rows;
}

export function matchPlaylist(rows: PlaylistRow[]): { row: PlaylistRow; song: Song | undefined }[] {
  return rows.map(row => ({ row, song: songs.find(song => {
    const artists = recordingArtistIds(song).map(id => getArtist(id)!);
    const names = [...artists.flatMap(artist => [artist.name, ...(artist.aliases || [])]), artists.map(artist => artist.name).join(', '), [...artists].reverse().map(artist => artist.name).join(', ')];
    return [song.title, ...(song.aliases || [])].some(title => normalize(title) === normalize(row.title))
      && (!row.artist || names.some(name => normalize(name) === normalize(row.artist)));
  }) }));
}
