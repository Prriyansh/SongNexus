// What's similar to an artist or song, and why. Similarity comes from listening data: ListenBrainz
// counts which artists and songs people play in the same sessions, and Deezer lists related artists.
// Every result carries the reasons it's there, so the Connection Web can explain its distances.

import { findRecordings, lookupMusicBrainz, mapArtist, musicBrainzContext, UpstreamError, withCache } from "./musicbrainz";
import { normalizeName, sourceJson } from "./credit-sources";
import type { SourceOptions } from "./credit-sources";
import { listenBrainzAudience } from "./listenbrainz";
import { songCompareUrl } from "./sound";
import type { ArtistDetails, RecordingDetails, SimilarLink, SimilarNode, SimilarReason, SimilarWeb, SourceReport } from "./types";

const LABS = "https://labs.api.listenbrainz.org";
const DEEZER = "https://api.deezer.com";
const ARTIST_ALGORITHM = "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30";
const SONG_ALGORITHM = "session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30";
const CACHE_MS = 24 * 60 * 60_000;

const MAX_ARTISTS = 30;
const MAX_SONGS = 24;
const MAX_PER_ARTIST = 2;
const LINK_SOURCES = 10;
const LINKS_PER_ARTIST = 5;
const SEED_TRIES = 5;
const ENOUGH_SONGS = 12;
const SOUND_CHECKS = 10;
const BATCH = 4;

type LbArtist = { artist_mbid?: string; name?: string; score?: number };
type LbSong = { recording_mbid?: string; recording_name?: string; artist_credit_name?: string; caa_id?: number | null; caa_release_mbid?: string | null; score?: number };
type DzArtist = { id?: number; name?: string; nb_fan?: number; picture_medium?: string; link?: string };

export { lbArtists, dzArtist, realPicture, inBatches, leadOf };

const asRows = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const rounded = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;
const quoted = (value: string) => `"${value.replace(/["\\]/g, "")}"`;
/** Deezer serves a generic silhouette for artists without a photo; its address has no image id. */
const realPicture = (url?: string) => (url && /\/images\/artist\/[0-9a-f]{10,}\//.test(url) ? url : null);
const leadOf = (credit: string) => credit.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bwith\b|\bx\b)\s*/i)[0] ?? credit;

const cached = <T>(key: string, options: SourceOptions, load: () => Promise<T>) => withCache(key, CACHE_MS, options.useCache ?? true, load);

function lbArtists(mbid: string, options: SourceOptions) {
  return cached(`lb-artists:${mbid}`, options, async () =>
    asRows<LbArtist>(await sourceJson("ListenBrainz", `${LABS}/similar-artists/json?artist_mbids=${mbid}&algorithm=${ARTIST_ALGORITHM}`, {}, options)));
}

function lbSongs(mbid: string, options: SourceOptions) {
  return cached(`lb-songs:${mbid}`, options, async () =>
    asRows<LbSong>(await sourceJson("ListenBrainz", `${LABS}/similar-recordings/json?recording_mbids=${mbid}&algorithm=${SONG_ALGORITHM}`, {}, options)));
}

/** The Deezer artist with exactly this name; if several share it, the one with the most fans. */
function dzArtist(name: string, options: SourceOptions): Promise<DzArtist | null> {
  return cached(`dz-artist:${normalizeName(name)}`, options, async () => {
    const body = await sourceJson<{ data?: DzArtist[] }>("Deezer", `${DEEZER}/search/artist?q=${encodeURIComponent(name)}&limit=10`, {}, options);
    const wanted = normalizeName(name);
    return (body.data ?? []).filter((a) => a.id && normalizeName(a.name ?? "") === wanted)
      .sort((x, y) => (y.nb_fan ?? 0) - (x.nb_fan ?? 0))[0] ?? null;
  });
}

function dzRelated(id: number, options: SourceOptions) {
  return cached(`dz-related:${id}`, options, async () =>
    (await sourceJson<{ data?: DzArtist[] }>("Deezer", `${DEEZER}/artist/${id}/related?limit=30`, {}, options)).data ?? []);
}

function dzTopTitles(id: number, options: SourceOptions) {
  return cached(`dz-top25:${id}`, options, async () =>
    ((await sourceJson<{ data?: { title?: string }[] }>("Deezer", `${DEEZER}/artist/${id}/top?limit=25`, {}, options)).data ?? []).flatMap((t) => t.title ?? []));
}

async function inBatches<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(...(await Promise.allSettled(items.slice(i, i + BATCH).map(run))));
  return out;
}

export type ArtistCandidate = { mbid: string | null; name: string; sessionScore: number; relatedRank: number | null; fans: number; picture: string | null; deezerUrl: string | null };

/**
 * Combines both sources. Closeness is mostly how often people play the two together, relative to
 * this artist's closest match; being on both lists adds confidence, one list alone counts for less.
 */
export function mergeArtistCandidates(lb: LbArtist[], related: DzArtist[], selfId: string, selfName: string): (ArtistCandidate & { similarity: number })[] {
  const self = normalizeName(selfName);
  const byName = new Map<string, ArtistCandidate>();
  for (const row of lb) {
    if (!row.artist_mbid || !row.name || row.artist_mbid === selfId || normalizeName(row.name) === self) continue;
    byName.set(normalizeName(row.name), { mbid: row.artist_mbid, name: row.name, sessionScore: row.score ?? 0, relatedRank: null, fans: 0, picture: null, deezerUrl: null });
  }
  related.forEach((row, rank) => {
    if (!row.name || normalizeName(row.name) === self) return;
    const key = normalizeName(row.name);
    const old = byName.get(key);
    byName.set(key, { mbid: old?.mbid ?? null, name: old?.name ?? row.name, sessionScore: old?.sessionScore ?? 0, relatedRank: rank, fans: row.nb_fan ?? 0, picture: realPicture(row.picture_medium), deezerUrl: row.link ?? null });
  });
  const top = Math.max(1, ...[...byName.values()].map((c) => c.sessionScore));
  const relatedCount = Math.max(1, related.length);
  return [...byName.values()].map((c) => {
    const session = c.sessionScore / top;
    const listed = c.relatedRank === null ? null : 1 - c.relatedRank / relatedCount;
    const similarity = c.sessionScore && listed !== null ? .7 * session + .3 * listed
      : c.sessionScore ? session * .85
      : (listed ?? 0) * .6;
    return { ...c, similarity: rounded(similarity) };
  });
}

/** Which to show first: mostly the closest, with a lean toward names people know. */
export function rankArtists<T extends { similarity: number; fans: number }>(candidates: T[]): T[] {
  const most = Math.max(1, ...candidates.map((c) => c.fans));
  const fame = (c: T) => Math.log10(1 + c.fans) / Math.log10(1 + most);
  return [...candidates].sort((x, y) => .75 * y.similarity + .25 * fame(y) - (.75 * x.similarity + .25 * fame(x)));
}

export function sharedTags(own: string[], other: string[]): string[] {
  const theirs = new Set(other.map((t) => t.toLowerCase()));
  return own.filter((t) => theirs.has(t.toLowerCase()));
}

const tagsOf = (artist: ArtistDetails) => [...new Set([...artist.genres.map((g) => g.name), ...artist.tags])];

async function resolveMissingIds(candidates: ArtistCandidate[]) {
  const missing = candidates.filter((c) => !c.mbid);
  if (!missing.length) return;
  const query = missing.map((c) => `artist:${quoted(c.name)}`).join(" OR ");
  const data = await musicBrainzContext<{ artists?: Parameters<typeof mapArtist>[0][] }>("artist", { query, limit: "100" });
  for (const raw of data.artists ?? []) {
    const artist = mapArtist(raw);
    // Results arrive best match first, so the first exact name wins.
    const match = missing.find((c) => !c.mbid && normalizeName(c.name) === normalizeName(artist.name));
    if (match) match.mbid = artist.id;
  }
}

async function similarArtists(artist: ArtistDetails, options: SourceOptions, reports: SourceReport[], viaSong?: string): Promise<{ nodes: SimilarNode[]; links: SimilarLink[]; deezer: DzArtist | null }> {
  const [lb, deezer] = await Promise.allSettled([lbArtists(artist.id, options), dzArtist(artist.name, options)]);
  const dz = deezer.status === "fulfilled" ? deezer.value : null;
  const related = dz?.id ? await dzRelated(dz.id, options).catch(() => [] as DzArtist[]) : [];
  reports.push({ source: "ListenBrainz", status: lb.status === "fulfilled" ? (lb.value.length ? "ok" : "no-match") : "failed" });
  reports.push({ source: "Deezer", status: deezer.status === "rejected" ? "failed" : dz ? "ok" : "no-match" });

  const merged = mergeArtistCandidates(lb.status === "fulfilled" ? lb.value : [], related, artist.id, artist.name);
  const ranked = rankArtists(merged).slice(0, MAX_ARTISTS + 10);
  await resolveMissingIds(ranked).catch((error) => console.warn("[similar] id lookup failed:", error));
  // Without a MusicBrainz id we couldn't open or explore this artist, so it isn't shown.
  const chosen = ranked.filter((c) => c.mbid).slice(0, MAX_ARTISTS);

  // Tags come from one combined search; photos for artists that only ListenBrainz listed.
  const tags = new Map<string, { tags: string[]; country: string }>();
  await musicBrainzContext<{ artists?: Parameters<typeof mapArtist>[0][] }>("artist", { query: chosen.map((c) => `arid:${c.mbid}`).join(" OR "), limit: "100" })
    .then((data) => { for (const raw of data.artists ?? []) { const a = mapArtist(raw); tags.set(a.id, { tags: a.tags, country: a.country }); } })
    .catch((error) => console.warn("[similar] tag lookup failed:", error));
  await inBatches(chosen.filter((c) => !c.picture), async (c) => {
    const found = await dzArtist(c.name, options);
    c.picture = realPicture(found?.picture_medium);
    c.fans ||= found?.nb_fan ?? 0;
    c.deezerUrl ??= found?.link ?? null;
  });
  const audience = await listenBrainzAudience(chosen.map((c) => c.mbid!), options).catch(() => new Map<string, { listeners: number } | null>());

  const anchorTags = tagsOf(artist);
  const nodes: SimilarNode[] = chosen.map((c, rank) => {
    const info = tags.get(c.mbid!);
    const shared = sharedTags(anchorTags, info?.tags ?? []).slice(0, 3);
    const reasons: SimilarReason[] = [];
    if (c.sessionScore) reasons.push({ kind: "listeners", text: `People who play ${viaSong ?? artist.name} often play ${c.name} in the same listening sessions.`, sourceUrl: `https://listenbrainz.org/artist/${c.mbid}` });
    if (c.relatedRank !== null) reasons.push({ kind: "related", text: `Deezer lists ${c.name} as related to ${artist.name}.`, sourceUrl: c.deezerUrl ?? undefined });
    if (shared.length) reasons.push({ kind: "style", text: `Both tagged ${shared.join(", ")} on MusicBrainz.`, sourceUrl: `https://musicbrainz.org/artist/${c.mbid}` });
    return { kind: "artist", id: c.mbid!, name: c.name, subtitle: shared[0] ?? info?.tags[0] ?? "", imageUrl: c.picture, similarity: c.similarity, rank, listeners: audience.get(c.mbid!)?.listeners ?? null, reasons };
  });

  // How the similar artists relate to each other, for the closest few: one request each.
  const ids = new Set(nodes.map((n) => n.id));
  const links = new Map<string, SimilarLink>();
  const sources = await inBatches(nodes.slice(0, LINK_SOURCES), async (node) => ({ id: node.id, rows: await lbArtists(node.id, options) }));
  for (const result of sources) {
    if (result.status !== "fulfilled") continue;
    for (const row of result.value.rows.filter((r) => r.artist_mbid && ids.has(r.artist_mbid)).slice(0, LINKS_PER_ARTIST)) {
      const pair = [result.value.id, row.artist_mbid!].sort();
      links.set(pair.join("|"), { from: pair[0], to: pair[1], kind: "listeners" });
    }
  }
  return { nodes, links: [...links.values()], deezer: dz };
}

/**
 * Which popular songs to look up, spread across the list and starting further down. The very top is
 * often this month's single, too new for listening data, so going straight down it can find nothing.
 */
export function seedTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const unique = titles.filter((t) => { const key = normalizeName(t); if (seen.has(key)) return false; seen.add(key); return true; });
  const step = Math.max(1, Math.floor(unique.length / SEED_TRIES));
  return unique.filter((_, i) => i % step === 0).reverse().slice(0, SEED_TRIES);
}

export function songCandidates(rows: LbSong[], seedTitles: string[], seedArtist: string): SimilarNode[] {
  const top = Math.max(1, ...rows.map((r) => r.score ?? 0));
  const seen = new Set(seedTitles.map(normalizeName));
  const perArtist = new Map<string, number>();
  const out: SimilarNode[] = [];
  for (const row of [...rows].sort((x, y) => (y.score ?? 0) - (x.score ?? 0))) {
    if (!row.recording_mbid || !row.recording_name) continue;
    const credit = row.artist_credit_name ?? "";
    // Versions of one song (live, remix, deluxe) count once.
    const title = normalizeName(row.recording_name.replace(/\s*[([].*?[)\]]/g, "").replace(/\s+-\s+.*$/, ""));
    const artistKey = normalizeName(leadOf(credit));
    if (seen.has(title)) continue;
    if ((perArtist.get(artistKey) ?? 0) >= MAX_PER_ARTIST) continue;
    seen.add(title);
    perArtist.set(artistKey, (perArtist.get(artistKey) ?? 0) + 1);
    out.push({
      kind: "song", id: row.recording_mbid, name: row.recording_name, subtitle: credit, artist: credit,
      imageUrl: row.caa_id && row.caa_release_mbid ? `https://coverartarchive.org/release/${row.caa_release_mbid}/${row.caa_id}-250.jpg` : null,
      similarity: rounded((row.score ?? 0) / top), rank: out.length, listeners: null,
      reasons: [{ kind: "listeners", text: `People who play “${seedTitles[0]}” by ${seedArtist} often play this in the same listening sessions.`, sourceUrl: `https://musicbrainz.org/recording/${row.recording_mbid}` }],
    });
  }
  return out;
}

/** The Song Compare service's explanation of how two songs sound alike, when it's running. */
async function addSoundReasons(nodes: SimilarNode[], seed: { title: string; artist: string }, options: SourceOptions, reports: SourceReport[]) {
  const base = songCompareUrl(options.env ?? process.env);
  if (!base) { reports.push({ source: "Song Compare", status: "no-key" }); return; }
  const match = (title: string, artist: string) =>
    sourceJson<{ track?: { id: string } }>("Song Compare", `${base}/api/match?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`, { signal: AbortSignal.timeout(5000) }, options);
  let seedId: string | undefined;
  try { seedId = (await match(seed.title, seed.artist)).track?.id; }
  catch (error) {
    // A song outside its 2022 catalog just has no sound reasons; only a service that's down is worth saying.
    if (!(error instanceof UpstreamError && error.message.includes("(404)"))) reports.push({ source: "Song Compare", status: "no-key" });
    return;
  }
  if (!seedId) return;
  await inBatches(nodes.slice(0, SOUND_CHECKS), async (node) => {
    const id = (await match(node.name, leadOf(node.artist ?? ""))).track?.id;
    if (!id || id === seedId) return;
    const comparison = await sourceJson<{ audio?: { score?: number }; reasons?: string[] }>("Song Compare", `${base}/api/compare?a=${seedId}&b=${id}`, {}, options);
    const about = (comparison.reasons ?? []).filter((r) => /tempo|close on|different on|keys are/i.test(r)).slice(0, 2).map((r) => r.replace(/\bvalence\b/g, "positivity"));
    if (typeof comparison.audio?.score === "number") node.reasons.push({ kind: "sound", text: `Calculated sound match: ${Math.round(comparison.audio.score * 100)}%. ${about.join(" ")}`.trim() });
  });
  reports.push({ source: "Song Compare", status: "ok" });
}

/** Links each song to its performer when that performer is also on the map. */
function performedLinks(songs: SimilarNode[], artists: { id: string; name: string }[]): SimilarLink[] {
  const byName = new Map(artists.map((a) => [normalizeName(a.name), a.id]));
  return songs.flatMap((song) => {
    const id = byName.get(normalizeName(leadOf(song.artist ?? "")));
    return id ? [{ from: id, to: song.id, kind: "performed" as const }] : [];
  });
}

export async function similarToArtist(id: string, options: SourceOptions = {}): Promise<SimilarWeb> {
  const artist = await lookupMusicBrainz({ type: "artist", id }) as ArtistDetails;
  const sources: SourceReport[] = [];
  const { nodes, links, deezer } = await similarArtists(artist, options, sources);

  // Similar songs start from this artist's most popular songs that have listening data.
  const titles = deezer?.id ? await dzTopTitles(deezer.id, options).catch(() => [] as string[]) : [];
  let songs: SimilarNode[] = [];
  const seeds: { id: string; title: string; art: string | null }[] = [];
  for (const title of seedTitles(titles)) {
    // One song often has several recordings, and listening data may sit on any of them.
    const recordings = await findRecordings(id, title).catch(() => []);
    let recording = recordings[0];
    let rows: LbSong[] = [];
    for (const candidate of recordings) {
      rows = await lbSongs(candidate.id, options).catch(() => []);
      if (rows.length) { recording = candidate; break; }
    }
    if (!rows.length) continue;
    seeds.push({ id: recording.id, title: recording.title, art: null });
    const fresh = songCandidates(rows, [recording.title, ...songs.map((s) => s.name)], artist.name);
    songs = [...songs, ...fresh].sort((x, y) => y.similarity - x.similarity).slice(0, MAX_SONGS);
    if (songs.length >= ENOUGH_SONGS) break;
  }
  songs.forEach((song, rank) => { song.rank = rank; });
  const center: SimilarNode = {
    kind: "artist", id, name: artist.name, subtitle: tagsOf(artist)[0] ?? "", imageUrl: realPicture(deezer?.picture_medium),
    similarity: 1, rank: 0, listeners: (await listenBrainzAudience([id], options).catch(() => new Map())).get(id)?.listeners ?? null, reasons: [],
  };
  return { center, artists: nodes, songs, links: [...links, ...performedLinks(songs, [...nodes, center])], sources, seedSongs: seeds.map((s) => s.title) };
}

export async function similarToSong(id: string, options: SourceOptions = {}): Promise<SimilarWeb> {
  const song = await lookupMusicBrainz({ type: "recording", id }) as RecordingDetails;
  const lead = song.artists.find((a) => a.id);
  const sources: SourceReport[] = [];
  let rows = await lbSongs(id, options).catch((error) => { console.warn("[similar] song lookup failed:", error); return null; });
  // Listening data may sit on another recording of the same song.
  if (rows && !rows.length && lead?.id) {
    for (const other of (await findRecordings(lead.id, song.title).catch(() => [])).filter((r) => r.id !== id)) {
      rows = await lbSongs(other.id, options).catch(() => []);
      if (rows.length) break;
    }
  }
  const songs = songCandidates(rows ?? [], [song.title], lead?.name ?? song.artists[0]?.name ?? "this artist").slice(0, MAX_SONGS);
  await addSoundReasons(songs, { title: song.title, artist: lead?.name ?? "" }, options, sources);

  let artists: SimilarNode[] = [], links: SimilarLink[] = [];
  let leadDetails: ArtistDetails | null = null;
  if (lead?.id) {
    leadDetails = await lookupMusicBrainz({ type: "artist", id: lead.id }) as ArtistDetails;
    const found = await similarArtists(leadDetails, options, sources, leadDetails.name);
    artists = found.nodes; links = found.links;
  }
  if (rows === null) sources.push({ source: "ListenBrainz songs", status: "failed" });
  const center: SimilarNode = {
    kind: "song", id, name: song.title, subtitle: song.artists.map((a) => a.name).join(", "), artist: song.artists[0]?.name,
    imageUrl: song.representative?.artUrl ?? null, similarity: 1, rank: 0, listeners: null, reasons: [],
  };
  return { center, artists, songs, links: [...links, ...performedLinks(songs, artists)], sources: dedupeReports(sources), seedSongs: [song.title] };
}

const dedupeReports = (reports: SourceReport[]) => [...new Map(reports.map((r) => [r.source, r])).values()];
