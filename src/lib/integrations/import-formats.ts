// Reads the export files music services give their users (privacy downloads, Google Takeout,
// Shazam's CSV) into one row shape. Pure and dependency-free, so the browser runs it on the file
// the user picked: big exports never have to be uploaded whole, and the server only receives rows,
// which it validates again (./imports.ts) because nothing from a browser is trusted.
//
// An imported file is a snapshot from the day it was exported. It is never called synced.

import type { EntityKind } from "./types";

export type ImportRow =
  | { t: "play"; title: string; artist: string; album?: string; playedAt: string; msPlayed?: number; id?: string; isrc?: string; mbid?: string }
  | { t: "library"; kind: EntityKind; relation: "saved" | "favorite"; title: string; artist?: string; album?: string; addedAt?: string; id?: string }
  | { t: "playlist_track"; playlist: string; title: string; artist: string; album?: string; addedAt?: string; id?: string };

export type ParsedImport = {
  format: string;
  rows: ImportRow[];
  /** Entries that were read but left out, with the reason, e.g. "12 podcast episodes". */
  skipped: { reason: string; count: number }[];
};

export type ImportFormat = { label: string; from: string; files: string; how: string };

export const IMPORT_FORMATS: Record<string, ImportFormat> = {
  "spotify-history": { label: "Spotify listening history", from: "Spotify", files: "StreamingHistory_music_*.json or Streaming_History_Audio_*.json", how: "spotify.com → Account → Privacy → Download your data. “Extended streaming history” has every play since you joined." },
  "spotify-library": { label: "Spotify library", from: "Spotify", files: "YourLibrary.json", how: "Part of Spotify’s “Account data” download." },
  "spotify-playlists": { label: "Spotify playlists", from: "Spotify", files: "Playlist1.json", how: "Part of Spotify’s “Account data” download." },
  "youtube-music-history": { label: "YouTube Music history", from: "YouTube Music", files: "watch-history.json", how: "takeout.google.com → YouTube and YouTube Music → history, in JSON format." },
  "youtube-music-library": { label: "YouTube Music library", from: "YouTube Music", files: "music library songs.csv", how: "takeout.google.com → YouTube and YouTube Music → music-library-songs." },
  "apple-music-activity": { label: "Apple Music play activity", from: "Apple Music", files: "Apple Music Play Activity.csv", how: "privacy.apple.com → Request a copy of your data → Apple Media Services information." },
  "apple-music-library": { label: "Apple Music library", from: "Apple Music", files: "Apple Music Library Tracks.json", how: "privacy.apple.com → Request a copy of your data → Apple Media Services information." },
  "listenbrainz-listens": { label: "ListenBrainz listens", from: "ListenBrainz", files: "listens .jsonl files", how: "listenbrainz.org → Settings → Export data." },
  "shazam-library": { label: "Shazam history", from: "Shazam", files: "shazamlibrary.csv", how: "shazam.com/myshazam → Download CSV." },
  generic: { label: "Playlist or history file", from: "Any service", files: "CSV or JSON with a title and an artist column", how: "Any export tool. Add a date column to import it as listening history." },
};

/** Spotify itself only counts a stream after 30 seconds; shorter entries are skips. */
export const MIN_PLAY_MS = 30_000;
export const MAX_IMPORT_ROWS = 500_000;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown) => { const n = typeof v === "string" && v.trim() ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : undefined; };

/** An ISO time, or undefined. Accepts ISO strings, "2023-01-31 12:34" (taken as UTC) and epoch seconds or milliseconds. */
export function toIso(value: unknown): string | undefined {
  if (typeof value === "number" || (typeof value === "string" && /^\d{9,13}$/.test(value.trim()))) {
    const n = Number(value);
    const ms = n < 1e11 ? n * 1000 : n;
    return Number.isFinite(ms) && ms > Date.UTC(1990, 0, 1) && ms < Date.now() + 86_400_000 ? new Date(ms).toISOString() : undefined;
  }
  const text = str(value);
  if (!text) return undefined;
  const plain = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(text);
  const ms = Date.parse(plain ? `${plain[1]}T${plain[2]}Z` : text);
  // Dates before recorded music streaming or in the future are typos or placeholder values.
  return Number.isFinite(ms) && ms > Date.UTC(1990, 0, 1) && ms < Date.now() + 86_400_000 ? new Date(ms).toISOString() : undefined;
}

/** Quoted cells may hold commas, escaped quotes and line breaks. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ",") { row.push(cell.trim()); cell = ""; }
    else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("The CSV has an unclosed quote. Check the file and try again.");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

class Skips {
  private counts = new Map<string, number>();
  add(reason: string) { this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1); }
  list() { return [...this.counts].map(([reason, count]) => ({ reason, count })); }
}

type Table = { get: (row: string[], ...names: string[]) => string; has: (...names: string[]) => boolean; all: (row: string[], prefix: string) => string[] };
function table(header: string[]): Table {
  const keys = header.map((h) => h.replace(/^﻿/, "").trim().toLowerCase());
  const find = (names: string[]) => names.map((n) => keys.indexOf(n)).find((i) => i >= 0) ?? -1;
  return {
    get: (row, ...names) => { const i = find(names); return i < 0 ? "" : (row[i] ?? "").trim(); },
    has: (...names) => find(names) >= 0,
    all: (row, prefix) => keys.flatMap((k, i) => (k.startsWith(prefix) && row[i]?.trim() ? [row[i].trim()] : [])),
  };
}

// ---- Spotify ----

function spotifyHistory(list: unknown[], skips: Skips): ImportRow[] {
  return list.flatMap((item): ImportRow[] => {
    const r = record(item);
    const extended = "ts" in r || "master_metadata_track_name" in r;
    const title = extended ? str(r.master_metadata_track_name) : str(r.trackName);
    const artist = extended ? str(r.master_metadata_album_artist_name) : str(r.artistName);
    const ms = num(extended ? r.ms_played : r.msPlayed);
    const playedAt = toIso(extended ? r.ts : r.endTime);
    if (!title || !artist) { skips.add(r.episode_name || r.spotify_episode_uri ? "podcast episodes" : "entries without a song title"); return []; }
    if (!playedAt) { skips.add("entries without a readable date"); return []; }
    if (ms !== undefined && ms < MIN_PLAY_MS) { skips.add("plays under 30 seconds (skips)"); return []; }
    const uri = str(r.spotify_track_uri);
    return [{ t: "play", title, artist, album: str(r.master_metadata_album_album_name) || undefined, playedAt, msPlayed: ms, id: uri || undefined }];
  });
}

function spotifyLibrary(root: Record<string, unknown>, skips: Skips): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const item of Array.isArray(root.tracks) ? root.tracks : []) {
    const r = record(item);
    if (str(r.track)) rows.push({ t: "library", kind: "track", relation: "saved", title: str(r.track), artist: str(r.artist) || undefined, album: str(r.album) || undefined, id: str(r.uri) || undefined });
    else skips.add("entries without a song title");
  }
  for (const item of Array.isArray(root.albums) ? root.albums : []) {
    const r = record(item);
    if (str(r.album)) rows.push({ t: "library", kind: "album", relation: "saved", title: str(r.album), artist: str(r.artist) || undefined, id: str(r.uri) || undefined });
  }
  for (const item of Array.isArray(root.artists) ? root.artists : []) {
    const r = record(item);
    if (str(r.name)) rows.push({ t: "library", kind: "artist", relation: "saved", title: str(r.name), id: str(r.uri) || undefined });
  }
  return rows;
}

function spotifyPlaylists(playlists: unknown[], skips: Skips): ImportRow[] {
  return playlists.flatMap((p) => {
    const playlist = record(p), name = str(playlist.name);
    if (!name) return [];
    return (Array.isArray(playlist.items) ? playlist.items : []).flatMap((item): ImportRow[] => {
      const outer = record(item), track = record(outer.track);
      if (!str(track.trackName)) { skips.add("playlist entries that aren’t songs"); return []; }
      return [{ t: "playlist_track", playlist: name, title: str(track.trackName), artist: str(track.artistName), album: str(track.albumName) || undefined, addedAt: toIso(outer.addedDate), id: str(track.trackUri) || undefined }];
    });
  });
}

// ---- Google Takeout ----

function youtubeMusicHistory(list: unknown[], skips: Skips): ImportRow[] {
  return list.flatMap((item): ImportRow[] => {
    const r = record(item);
    // The file mixes YouTube and YouTube Music; only the latter is listening.
    if (str(r.header) !== "YouTube Music") { skips.add("YouTube (not YouTube Music) entries"); return []; }
    const title = str(r.title).replace(/^Watched\s+/, "");
    const artist = str(record((Array.isArray(r.subtitles) ? r.subtitles : [])[0]).name).replace(/\s+-\s+Topic$/, "");
    const playedAt = toIso(r.time);
    if (!title || !playedAt || /^https?:\/\//.test(title)) { skips.add("entries for videos that were removed"); return []; }
    const id = /[?&]v=([\w-]{6,20})/.exec(str(r.titleUrl))?.[1];
    return [{ t: "play", title, artist, playedAt, id }];
  });
}

function youtubeMusicLibrary(rows: string[][], t: Table, skips: Skips): ImportRow[] {
  return rows.flatMap((row): ImportRow[] => {
    const title = t.get(row, "song title", "title");
    if (!title) { skips.add("rows without a song title"); return []; }
    const artists = t.all(row, "artist name");
    return [{ t: "library", kind: "track", relation: "saved", title, artist: artists.join(", ") || undefined, album: t.get(row, "album title") || undefined, id: t.get(row, "video id") || undefined }];
  });
}

// ---- Apple ----

function appleActivity(rows: string[][], t: Table, skips: Skips): ImportRow[] {
  return rows.flatMap((row): ImportRow[] => {
    const title = t.get(row, "song name", "content name", "track description");
    const playedAt = toIso(t.get(row, "event start timestamp", "event end timestamp", "event timestamp"));
    const ms = num(t.get(row, "play duration milliseconds"));
    if (!title) { skips.add("rows without a song name"); return []; }
    if (!playedAt) { skips.add("rows without a readable date"); return []; }
    if (ms !== undefined && ms < MIN_PLAY_MS) { skips.add("plays under 30 seconds (skips)"); return []; }
    return [{ t: "play", title, artist: t.get(row, "artist name", "container artist name"), album: t.get(row, "album name", "container album name", "container name") || undefined, playedAt, msPlayed: ms }];
  });
}

function appleLibrary(list: unknown[], skips: Skips): ImportRow[] {
  return list.flatMap((item): ImportRow[] => {
    const r = record(item);
    if (!str(r.Title)) { skips.add("entries without a title"); return []; }
    const id = str(r["Apple Music Track Identifier"]) || str(r["Track Identifier"]);
    return [{ t: "library", kind: "track", relation: "saved", title: str(r.Title), artist: str(r.Artist) || undefined, album: str(r.Album) || undefined, addedAt: toIso(r["Date Added"]), id: id || undefined }];
  });
}

// ---- ListenBrainz, Shazam, generic ----

function listenBrainz(list: unknown[], skips: Skips): ImportRow[] {
  return list.flatMap((item): ImportRow[] => {
    const r = record(item), meta = record(r.track_metadata), info = record(meta.additional_info), mapping = record(meta.mbid_mapping);
    const title = str(meta.track_name), playedAt = toIso(r.listened_at);
    if (!title || !playedAt) { skips.add("listens without a title or time"); return []; }
    return [{
      t: "play", title, artist: str(meta.artist_name), album: str(meta.release_name) || undefined, playedAt, msPlayed: num(info.duration_ms),
      id: str(r.recording_msid) || str(info.recording_msid) || undefined, mbid: str(mapping.recording_mbid) || str(info.recording_mbid) || undefined, isrc: str(info.isrc) || undefined,
    }];
  });
}

function shazam(rows: string[][], t: Table, skips: Skips): ImportRow[] {
  return rows.flatMap((row): ImportRow[] => {
    const title = t.get(row, "title");
    if (!title) { skips.add("rows without a title"); return []; }
    // A Shazam is a recognition, not a play, so it's a saved song with the time it was identified.
    return [{ t: "library", kind: "track", relation: "saved", title, artist: t.get(row, "artist") || undefined, addedAt: toIso(t.get(row, "tagtime")), id: t.get(row, "trackkey") || undefined }];
  });
}

const TITLE = ["track name", "title", "song", "name", "track", "song title"];
const ARTIST = ["artist name(s)", "artist name", "artist", "artists"];
const ALBUM = ["album name", "album", "album title"];
const PLAYED = ["played at", "played_at", "timestamp", "listened at", "date", "time", "uts"];

function genericTable(rows: string[][], t: Table, skips: Skips): ImportRow[] {
  const timed = t.has(...PLAYED);
  return rows.flatMap((row): ImportRow[] => {
    const title = t.get(row, ...TITLE), artist = t.get(row, ...ARTIST), album = t.get(row, ...ALBUM) || undefined;
    if (!title) { skips.add("rows without a title"); return []; }
    if (!timed) return [{ t: "library", kind: "track", relation: "saved", title, artist: artist || undefined, album, addedAt: toIso(t.get(row, "added at", "date added")) }];
    const playedAt = toIso(t.get(row, ...PLAYED));
    if (!playedAt) { skips.add("rows without a readable date"); return []; }
    return [{ t: "play", title, artist, album, playedAt }];
  });
}

function genericJson(list: unknown[], skips: Skips): ImportRow[] {
  return list.flatMap((item): ImportRow[] => {
    const outer = record(item), r = outer.track && typeof outer.track === "object" ? record(outer.track) : outer;
    const title = str(r.title) || str(r.name) || str(r.track);
    const artist = str(r.artist) || (Array.isArray(r.artists) ? r.artists.map((a) => (typeof a === "string" ? a : str(record(a).name))).filter(Boolean).join(", ") : "");
    if (!title) { skips.add("entries without a title"); return []; }
    const playedAt = toIso(outer.played_at ?? outer.playedAt ?? outer.timestamp);
    return playedAt ? [{ t: "play", title, artist, album: str(r.album) || undefined, playedAt }] : [{ t: "library", kind: "track", relation: "saved", title, artist: artist || undefined, album: str(record(r.album).name) || str(r.album) || undefined }];
  });
}

/**
 * Works out which export a file is from its contents (the filename is only a tiebreaker) and
 * returns its rows. Throws an Error with a message for the user when the file can't be used.
 */
export function parseImport(filename: string, text: string): ParsedImport {
  const body = text.replace(/^﻿/, "").trim();
  if (!body) throw new Error("That file is empty.");
  const skips = new Skips();
  const done = (format: string, rows: ImportRow[]): ParsedImport => {
    if (!rows.length) throw new Error(`No ${IMPORT_FORMATS[format].label.toLowerCase()} entries were found in that file.`);
    if (rows.length > MAX_IMPORT_ROWS) throw new Error(`That file has more than ${MAX_IMPORT_ROWS.toLocaleString("en")} entries. Split it and import the parts.`);
    return { format, rows, skipped: skips.list() };
  };

  if (/\.jsonl$/i.test(filename) || /^\{[^\n]*\}\s*\n\s*\{/.test(body)) {
    const lines = body.split(/\r?\n/).filter((line) => line.trim());
    const list = lines.flatMap((line) => { try { return [JSON.parse(line) as unknown]; } catch { skips.add("lines that aren’t valid JSON"); return []; } });
    return done("listenbrainz-listens", listenBrainz(list, skips));
  }

  if (body.startsWith("{") || body.startsWith("[")) {
    let value: unknown;
    try { value = JSON.parse(body); } catch { throw new Error("That file isn’t valid JSON. If it’s part of a .zip, unzip it and pick the file inside."); }
    const root = record(value);
    if (Array.isArray(root.playlists)) return done("spotify-playlists", spotifyPlaylists(root.playlists, skips));
    if (Array.isArray(root.tracks) && root.tracks.some((item) => "track" in record(item) && "artist" in record(item))) return done("spotify-library", spotifyLibrary(root, skips));
    const list = Array.isArray(value) ? value : Array.isArray(root.tracks) ? root.tracks : Array.isArray(root.songs) ? root.songs : Array.isArray(root.items) ? root.items : Array.isArray(root.listens) ? root.listens : null;
    if (!list) throw new Error("That JSON isn’t a list of songs or plays that Song Nexus recognises.");
    const first = record(list.find((item) => item && typeof item === "object"));
    if ("master_metadata_track_name" in first || "ms_played" in first || ("endTime" in first && "trackName" in first)) return done("spotify-history", spotifyHistory(list, skips));
    if ("header" in first && "titleUrl" in first || "header" in first && "time" in first) return done("youtube-music-history", youtubeMusicHistory(list, skips));
    if ("track_metadata" in first) return done("listenbrainz-listens", listenBrainz(list, skips));
    if ("Title" in first && ("Artist" in first || "Date Added" in first)) return done("apple-music-library", appleLibrary(list, skips));
    return done("generic", genericJson(list, skips));
  }

  let cells = readCsv(body);
  // Shazam's file opens with a title line before the header.
  if (cells[0]?.length === 1 && /^shazam library$/i.test(cells[0][0])) cells = cells.slice(1);
  const [header, ...rows] = cells;
  if (!header || header.length < 2) throw new Error("That file isn’t a CSV or JSON export Song Nexus recognises.");
  const t = table(header);
  if (t.has("tagtime") && t.has("title")) return done("shazam-library", shazam(rows, t, skips));
  if (t.has("event start timestamp", "play duration milliseconds") && t.has("song name", "content name", "track description")) return done("apple-music-activity", appleActivity(rows, t, skips));
  if (t.has("song title")) return done("youtube-music-library", youtubeMusicLibrary(rows, t, skips));
  if (t.has(...TITLE)) return done("generic", genericTable(rows, t, skips));
  throw new Error("That CSV needs a Title (or Track Name) column. An Artist column is strongly recommended.");
}

/** What the preview shows before anything is stored. */
export function summarize(parsed: ParsedImport) {
  const plays = parsed.rows.filter((r) => r.t === "play");
  const times = plays.map((r) => (r.t === "play" ? r.playedAt : "")).sort();
  const seen = new Set<string>();
  let repeats = 0;
  for (const r of parsed.rows) {
    const key = r.t === "play" ? `p|${r.title}|${r.artist}|${r.playedAt}` : r.t === "library" ? `l|${r.kind}|${r.title}|${r.artist ?? ""}` : "";
    if (!key) continue;
    if (seen.has(key)) repeats++; else seen.add(key);
  }
  return {
    plays: plays.length,
    library: parsed.rows.filter((r) => r.t === "library").length,
    playlistTracks: parsed.rows.filter((r) => r.t === "playlist_track").length,
    playlists: new Set(parsed.rows.flatMap((r) => (r.t === "playlist_track" ? [r.playlist] : []))).size,
    oldest: times[0] ?? null,
    newest: times[times.length - 1] ?? null,
    /** Identical entries inside the file itself; they'd be stored once. */
    repeatsInFile: repeats,
  };
}
