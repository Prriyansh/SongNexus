// Builds a map from one playlist, or from a playlist and a friend's. Playlists arrive with the
// request and aren't stored. "Similar" comes from ListenBrainz listening data; every node says why it's there.

import { mapArtist, musicBrainzContext } from "./musicbrainz";
import { normalizeName, sourceJson } from "./credit-sources";
import type { SourceOptions } from "./credit-sources";
import { dzArtist, inBatches, lbArtists, leadOf, realPicture } from "./similar";
import type { PlaylistSong, SourceReport, TasteGroup, TasteLink, TasteMap, TasteNode, TasteRequest } from "./types";

const MAX_ROWS = 250;
const MAX_TEXT = 200;
const MAX_NAME = 30;
const ARTISTS_TO_CHECK = 15;
const SHOWN_ARTISTS = 14;
const SHOWN_SONGS = 8;
const SHOWN_NEW = 12;
const SHOWN_SIMILAR_LINKS = 40;
/** How far down an artist's similar list still counts as close. Popular artists connect to everyone further down. */
const SIMILAR_DEPTH = 15;
const RECOMMENDED_LINKS = 3;

const songKey = (song: PlaylistSong) => `${normalizeName(song.title.replace(/\s*[([].*?[)\]]/g, "").replace(/\s+-\s+.*$/, ""))}|${normalizeName(leadOf(song.artist))}`;

/** Playlists come from the visitor's file or a friend's link, so nothing about them is trusted. */
export function parseTasteRequest(body: unknown): TasteRequest | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const rows = (value: unknown): PlaylistSong[] | null => {
    if (!Array.isArray(value) || value.length > MAX_ROWS) return null;
    return value.flatMap((row) => {
      const song = row as Record<string, unknown>;
      return typeof song?.title === "string" && song.title.trim() && typeof song.artist === "string" && song.artist.trim()
        ? [{ title: song.title.trim().slice(0, MAX_TEXT), artist: song.artist.trim().slice(0, MAX_TEXT) }] : [];
    });
  };
  const mine = rows(raw.mine);
  if (!mine?.length) return null;
  const friend = raw.friend === undefined ? undefined : rows(raw.friend);
  if (friend === null || (friend && !friend.length)) return null;
  return { mine, ...(friend ? { friend } : {}), ...(typeof raw.friendName === "string" && raw.friendName.trim() ? { friendName: raw.friendName.trim().slice(0, MAX_NAME) } : {}) };
}

/** A name and playlist for a room, from an untrusted request body. */
export function parseMember(body: unknown): { name: string; songs: PlaylistSong[] } | null {
  const raw = body as { name?: unknown; songs?: unknown } | null;
  const parsed = parseTasteRequest({ mine: raw?.songs });
  if (!parsed) return null;
  return { name: typeof raw?.name === "string" ? raw.name.trim().slice(0, MAX_NAME) : "", songs: parsed.mine };
}

export type Shelf = { artists: Map<string, { name: string; songs: PlaylistSong[] }>; songs: Map<string, PlaylistSong> };

export function shelfOf(rows: PlaylistSong[]): Shelf {
  const shelf: Shelf = { artists: new Map(), songs: new Map() };
  for (const song of rows) {
    const key = songKey(song);
    if (shelf.songs.has(key)) continue;
    shelf.songs.set(key, song);
    const name = leadOf(song.artist).trim();
    const artistKey = normalizeName(name);
    if (!artistKey) continue;
    const entry = shelf.artists.get(artistKey) ?? { name, songs: [] };
    entry.songs.push(song);
    shelf.artists.set(artistKey, entry);
  }
  return shelf;
}

const topKeys = (shelf: Shelf, count: number) => [...shelf.artists].sort(([, x], [, y]) => y.songs.length - x.songs.length).slice(0, count).map(([key]) => key);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const listNames = (names: string[]) => {
  if (names.length > 3) return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return names.length === 3 ? `${names[0]}, ${names[1]} and ${names[2]}` : names.join(" and ");
};

export type SimilarRow = { name: string; mbid: string };

/**
 * The map itself, from what's on the playlists and what each checked artist is similar to.
 * Pure, so what counts as shared or recommended can be tested without any network.
 */
export function buildTasteMap(mine: Shelf, friend: Shelf | null, similarTo: Map<string, SimilarRow[]>, mbids: Map<string, string>, friendName = "your friend"): Omit<TasteMap, "sources"> {
  const hasFriend = !!friend;
  const theirs = friend ?? { artists: new Map(), songs: new Map() } as Shelf;
  const sharedArtists = [...mine.artists.keys()].filter((key) => theirs.artists.has(key));
  const sharedSongs = [...mine.songs.keys()].filter((key) => theirs.songs.has(key));

  // Which of one person's artists does this artist sit close to?
  const closeTo = (key: string, shelf: Shelf) => {
    const names: string[] = [];
    for (const [source, entry] of shelf.artists) {
      if (source === key) continue;
      const fromSource = similarTo.get(source)?.some((row) => normalizeName(row.name) === key);
      const toSource = similarTo.get(key)?.some((row) => normalizeName(row.name) === source);
      if (fromSource || toSource) names.push(entry.name);
    }
    return names;
  };

  const links = new Map<string, TasteLink>();
  const link = (from: string, to: string, kind: TasteLink["kind"]) => {
    const key = `${[from, to].sort().join("|")}`;
    if (!links.has(key)) links.set(key, { from, to, kind });
  };
  const nodes: TasteNode[] = [];
  const artistId = (key: string) => `artist:${key}`;

  const addArtist = (key: string, name: string, group: TasteGroup, weight: number, reasons: string[]) => {
    nodes.push({ kind: "artist", id: artistId(key), name, subtitle: "", mbid: mbids.get(key) ?? null, imageUrl: null, group, weight, reasons: reasons.map((text) => ({ kind: "listeners", text })) });
  };

  // Artists on the playlists, most-played first.
  const ranked = (shelf: Shelf, others: Set<string>) => [...shelf.artists].filter(([key]) => !others.has(key)).sort(([, x], [, y]) => y.songs.length - x.songs.length).slice(0, SHOWN_ARTISTS);
  const shared = new Set(sharedArtists);
  for (const key of sharedArtists) {
    const m = mine.artists.get(key)!, t = theirs.artists.get(key)!;
    addArtist(key, m.name, "shared", m.songs.length + t.songs.length, [`On both playlists: ${plural(m.songs.length, "song")} of yours and ${plural(t.songs.length, "song")} of ${friendName}’s.`]);
  }
  for (const [key, entry] of ranked(mine, shared)) {
    const near = hasFriend ? closeTo(key, theirs) : [];
    addArtist(key, entry.name, near.length ? "for-them" : "mine", entry.songs.length, [
      `On your playlist (${plural(entry.songs.length, "song")}).`,
      ...(near.length ? [`${friendName} might like this: people who play ${listNames(near)}, on ${friendName}’s playlist, often play ${entry.name} too.`] : []),
    ]);
  }
  for (const [key, entry] of ranked(theirs, shared)) {
    const near = closeTo(key, mine);
    addArtist(key, entry.name, near.length ? "for-me" : "theirs", entry.songs.length, [
      `On ${friendName}’s playlist (${plural(entry.songs.length, "song")}).`,
      ...(near.length ? [`You might like this: people who play ${listNames(near)}, on your playlist, often play ${entry.name} too.`] : []),
    ]);
  }
  const onMap = new Set(nodes.map((n) => n.id));

  // Lines between artists on different playlists (or within one, with no friend) that listeners connect.
  let similarLinks = 0;
  const sources = [...mine.artists.keys()].filter((key) => onMap.has(artistId(key)));
  const targets = hasFriend ? [...theirs.artists.keys()] : sources;
  for (const a of sources) for (const b of targets) {
    if (a === b || similarLinks >= SHOWN_SIMILAR_LINKS || !onMap.has(artistId(b))) continue;
    const connected = similarTo.get(a)?.some((row) => normalizeName(row.name) === b) || similarTo.get(b)?.some((row) => normalizeName(row.name) === a);
    if (connected && !links.has([artistId(a), artistId(b)].sort().join("|"))) { link(artistId(a), artistId(b), "similar"); similarLinks++; }
  }

  // Songs: everything on both, then each person's from the artists that matter on the map.
  const addSong = (key: string, song: PlaylistSong, group: TasteGroup, reasons: string[]) => {
    const id = `song:${key}`;
    nodes.push({ kind: "song", id, name: song.title, subtitle: song.artist, artist: song.artist, mbid: null, imageUrl: null, group, weight: 1, reasons: reasons.map((text) => ({ kind: "listeners", text })) });
    const owner = artistId(normalizeName(leadOf(song.artist)));
    if (onMap.has(owner)) link(owner, id, "contains");
  };
  for (const key of sharedSongs) addSong(key, mine.songs.get(key)!, "shared", ["On both of your playlists."]);
  const sharedSongSet = new Set(sharedSongs);
  const songGroup = (song: PlaylistSong) => nodes.find((n) => n.id === artistId(normalizeName(leadOf(song.artist))))?.group;
  const songsOf = (shelf: Shelf) => [...shelf.songs].filter(([key]) => !sharedSongSet.has(key))
    .sort(([, x], [, y]) => Number(songGroup(y) === "for-me" || songGroup(y) === "for-them") - Number(songGroup(x) === "for-me" || songGroup(x) === "for-them"))
    .slice(0, SHOWN_SONGS);
  for (const [key, song] of songsOf(mine)) {
    const flagged = songGroup(song) === "for-them";
    addSong(key, song, flagged ? "for-them" : "mine", [`On your playlist.`, ...(flagged ? [`${friendName} might like this: ${leadOf(song.artist)} is close to what ${friendName} plays.`] : [])]);
  }
  for (const [key, song] of songsOf(theirs)) {
    const flagged = songGroup(song) === "for-me";
    addSong(key, song, flagged ? "for-me" : "theirs", [`On ${friendName}’s playlist.`, ...(flagged ? [`You might like this: ${leadOf(song.artist)} is close to what you play.`] : [])]);
  }

  // New to both: artists the listening data connects to what's on the playlists, the more connections the better.
  const candidates = new Map<string, { name: string; mbid: string; mine: string[]; theirs: string[] }>();
  for (const [source, rows] of similarTo) {
    const inMine = mine.artists.get(source), inTheirs = theirs.artists.get(source);
    for (const row of rows) {
      const key = normalizeName(row.name);
      if (mine.artists.has(key) || theirs.artists.has(key)) continue;
      const entry = candidates.get(key) ?? { name: row.name, mbid: row.mbid, mine: [], theirs: [] };
      if (inMine) entry.mine.push(inMine.name);
      if (inTheirs) entry.theirs.push(inTheirs.name);
      candidates.set(key, entry);
    }
  }
  const newOnes = [...candidates]
    // With a friend, what links both of you beats what links one; alone, what links several of your artists.
    .sort(([, x], [, y]) => (hasFriend ? Number(!!(y.mine.length && y.theirs.length)) - Number(!!(x.mine.length && x.theirs.length)) : 0) || (y.mine.length + y.theirs.length) - (x.mine.length + x.theirs.length))
    .slice(0, SHOWN_NEW);
  for (const [key, c] of newOnes) {
    const why = hasFriend && c.mine.length && c.theirs.length
      ? `New to both of you: people who play ${listNames(c.mine)} (yours) and ${listNames(c.theirs)} (${friendName}’s) often play ${c.name} too.`
      : `New to ${hasFriend ? "both of you" : "you"}: people who play ${listNames([...c.mine, ...c.theirs])} often play ${c.name} too.`;
    mbids.set(key, c.mbid);
    addArtist(key, c.name, "new", c.mine.length + c.theirs.length, [why]);
    // A few lines each, one from each side first: the card names the rest.
    for (const source of [...new Set([c.mine[0], c.theirs[0], ...c.mine, ...c.theirs].filter(Boolean))].slice(0, RECOMMENDED_LINKS)) {
      const sourceId = artistId(normalizeName(source));
      if (onMap.has(sourceId)) link(sourceId, artistId(key), "recommended");
    }
  }

  return {
    nodes,
    links: [...links.values()],
    stats: { mineSongs: mine.songs.size, mineArtists: mine.artists.size, friendSongs: theirs.songs.size, friendArtists: theirs.artists.size, sharedArtists: sharedArtists.length, sharedSongs: sharedSongs.length, similarLinks },
  };
}

/** MusicBrainz ids for playlist artists, by exact name. An artist without one still shows, with no similar artists. */
async function resolveArtists(names: string[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (!names.length) return ids;
  const query = names.map((name) => `artist:"${name.replace(/["\\]/g, "")}"`).join(" OR ");
  const data = await musicBrainzContext<{ artists?: Parameters<typeof mapArtist>[0][] }>("artist", { query, limit: "100" });
  for (const raw of data.artists ?? []) {
    const artist = mapArtist(raw);
    const key = normalizeName(artist.name);
    // Best match first, so the first exact name wins.
    if (!ids.has(key) && names.some((name) => normalizeName(name) === key)) ids.set(key, artist.id);
  }
  return ids;
}

export async function buildTaste(request: TasteRequest, options: SourceOptions = {}): Promise<TasteMap> {
  const mine = shelfOf(request.mine);
  const friend = request.friend ? shelfOf(request.friend) : null;
  const sources: SourceReport[] = [];

  const keys = [...new Set([...topKeys(mine, ARTISTS_TO_CHECK), ...(friend ? topKeys(friend, ARTISTS_TO_CHECK) : [])])];
  const nameOf = (key: string) => mine.artists.get(key)?.name ?? friend?.artists.get(key)?.name ?? key;
  let mbids = new Map<string, string>();
  try {
    mbids = await resolveArtists(keys.map(nameOf));
    sources.push({ source: "MusicBrainz", status: "ok" });
  } catch (error) {
    console.warn("[taste] artist lookup failed:", error);
    sources.push({ source: "MusicBrainz", status: "failed" });
  }

  const similarTo = new Map<string, SimilarRow[]>();
  const lookups = await inBatches(keys.filter((key) => mbids.has(key)), async (key) => {
    const rows = await lbArtists(mbids.get(key)!, options);
    similarTo.set(key, rows.slice(0, SIMILAR_DEPTH).flatMap((row) => (row.name && row.artist_mbid ? [{ name: row.name, mbid: row.artist_mbid }] : [])));
  });
  const failed = lookups.filter((r) => r.status === "rejected").length;
  sources.push({ source: "ListenBrainz", status: !lookups.length ? "no-match" : failed === lookups.length ? "failed" : failed ? "partial" : "ok" });

  const map = buildTasteMap(mine, friend, similarTo, mbids, request.friendName);

  // Pictures: artist photos and song covers from Deezer, by exact name and title only.
  const dzFailures = await inBatches(map.nodes, async (node) => {
    if (node.kind === "artist") {
      node.imageUrl = realPicture((await dzArtist(node.name, options))?.picture_medium);
      return;
    }
    const q = encodeURIComponent(`${node.name} ${leadOf(node.artist ?? "")}`);
    const body = await sourceJson<{ data?: { title?: string; title_short?: string; artist?: { name?: string }; album?: { cover_medium?: string } }[] }>("Deezer", `https://api.deezer.com/search/track?q=${q}&limit=5`, {}, options);
    const wanted = normalizeName(leadOf(node.artist ?? ""));
    const match = (body.data ?? []).find((t) => normalizeName(t.artist?.name ?? "") === wanted && normalizeName(t.title_short ?? t.title ?? "") === normalizeName(node.name.replace(/\s*[([].*?[)\]]/g, "")));
    node.imageUrl = match?.album?.cover_medium ?? null;
  });
  sources.push({ source: "Deezer", status: dzFailures.some((r) => r.status === "rejected") ? "partial" : "ok" });
  return { ...map, sources };
}
