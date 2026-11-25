// Small, reusable MusicBrainz integration layer shared by both comparison
// features. Keeps all upstream knowledge (endpoints, schema, rate limits,
// User-Agent) out of the UI and the route handlers.
//
// MusicBrainz API docs: https://musicbrainz.org/doc/MusicBrainz_API
// - Requires a descriptive, identifiable User-Agent.
// - Asks clients to average no more than ~1 request/second per IP.
// - Search endpoints do not accept `inc=`; `lookup` does (genres, rels, etc.).
//
// RATE-LIMIT CAVEAT (serverless): the throttle and cache below live in module
// memory, which is PER INSTANCE. On a platform like Vercel multiple instances
// can run concurrently, so this does NOT guarantee a global 1 req/sec across
// the whole deployment. It is best-effort smoothing plus request de-duplication
// and caching. For a hard global limit, back the throttle/cache with a shared
// store (e.g. Upstash Redis / Vercel KV) — see README notes.

import type {
  Artist,
  ArtistDetails,
  Collaborator,
  CollaboratorComparison,
  Coverage,
  DetailsResult,
  Discography,
  ExternalIds,
  Genre,
  LinkRef,
  Rating,
  RecordingDetails,
  ReleaseRef,
  Result,
  Song,
  TrackRef,
  YearSpan,
} from "./types";

export type SearchType = "recording" | "artist";

const MB_BASE = "https://musicbrainz.org/ws/2";
const COVER_ART_BASE = "https://coverartarchive.org";
// Identifiable User-Agent as required by MusicBrainz. The repo URL is a valid
// point of contact; no secrets are involved.
const USER_AGENT = "SongNexus/1.0.0 (https://github.com/Prriyansh/SongNexus)";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
const REQUEST_TIMEOUT_MS = 10_000;
const MIN_REQUEST_SPACING_MS = 1_100; // best-effort: stay under 1 req/sec
const SEARCH_TTL_MS = 5 * 60_000; // searches change rarely
const LOOKUP_TTL_MS = 30 * 60_000; // artist/recording details change even less
const STALE_TTL_MS = 24 * 60 * 60_000; // serve stale on upstream failure for a day
const MAX_RETRIES = 2; // up to 3 attempts total
const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 4_000;
const MAX_RETRY_AFTER_MS = 5_000; // don't honor absurd Retry-After within a request
const ALBUM_PAGE_SIZE = 100; // MusicBrainz browse maximum

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown for bad client input; maps to HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Thrown when MusicBrainz itself fails; carries a status to surface upstream.
 * `retryable` tells the client whether trying again soon may succeed.
 */
export class UpstreamError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status = 502, retryable = false) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.retryable = retryable;
  }
}

// --- Small safe coercion helpers -------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function yearOf(date: string): string {
  return /^\d{4}/.test(date) ? date.slice(0, 4) : "";
}

// --- Raw upstream shapes (only the fields we read) -------------------------

type RawTag = { name?: unknown; count?: unknown };
type RawGenre = { name?: unknown; count?: unknown };
type RawRating = { value?: unknown; "votes-count"?: unknown };

type RawArtistCredit = {
  name?: unknown;
  artist?: { id?: unknown; name?: unknown } | null;
};

type RawRelease = {
  id?: unknown;
  title?: unknown;
  date?: unknown;
  "release-group"?: { id?: unknown } | null;
};

type RawRelationUrl = { resource?: unknown };
type RawRelation = {
  type?: unknown;
  "target-type"?: unknown;
  url?: RawRelationUrl | null;
  artist?: RawArtist | null;
  work?: { relations?: RawRelation[] } | null;
  direction?: unknown;
  begin?: unknown;
  end?: unknown;
  ended?: unknown;
};

type RawReleaseGroup = {
  id?: unknown;
  title?: unknown;
  "primary-type"?: unknown;
  "secondary-types"?: unknown[];
  "first-release-date"?: unknown;
};

type RawRecording = {
  id?: unknown;
  title?: unknown;
  length?: unknown;
  disambiguation?: unknown;
  "artist-credit"?: RawArtistCredit[];
  tags?: RawTag[];
  genres?: RawGenre[];
  rating?: RawRating | null;
  releases?: RawRelease[];
  "first-release-date"?: unknown;
  relations?: RawRelation[];
};

type RawArtist = {
  id?: unknown;
  name?: unknown;
  disambiguation?: unknown;
  country?: unknown;
  type?: unknown;
  gender?: unknown;
  area?: { name?: unknown } | null;
  "begin-area"?: { name?: unknown } | null;
  tags?: RawTag[];
  genres?: RawGenre[];
  rating?: RawRating | null;
  "life-span"?: { begin?: unknown; end?: unknown; ended?: unknown } | null;
  "release-groups"?: RawReleaseGroup[];
  relations?: RawRelation[];
};

// --- Normalizers ------------------------------------------------------------

/**
 * Normalizes MusicBrainz tags/genres: drops blanks, keeps only positive vote
 * counts (negative/zero are disputed or unvoted noise), sorts by votes,
 * dedupes case-insensitively, and caps the list so the UI stays readable.
 */
function mapCounted(
  items: (RawTag | RawGenre)[] | undefined,
  max = 10
): Genre[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items
    .map((item) => ({
      name: str(item?.name).trim().toLowerCase(),
      count: typeof item?.count === "number" ? item.count : 0,
    }))
    .filter((item) => item.name.length > 0 && item.count > 0)
    .sort((a, b) => b.count - a.count)
    .filter((item) => (seen.has(item.name) ? false : (seen.add(item.name), true)))
    .slice(0, max);
}

function mapTags(tags: RawTag[] | undefined, max = 8): string[] {
  return mapCounted(tags, max).map((t) => t.name);
}

function mapRating(raw: RawRating | null | undefined): Rating | null {
  if (!raw) return null;
  const value = typeof raw.value === "number" ? raw.value : null;
  const votes = typeof raw["votes-count"] === "number" ? raw["votes-count"] : 0;
  if (value == null || votes <= 0) return null;
  return { value, votes };
}

// A conservative allowlist of relation types worth showing as "links".
const USEFUL_LINK_TYPES = new Set([
  "official homepage",
  "streaming",
  "free streaming",
  "purchase for download",
  "bandcamp",
  "youtube",
  "youtube music",
  "soundcloud",
  "discogs",
  "allmusic",
  "last.fm",
  "lyrics",
  "wikidata",
]);

function mapLinks(relations: RawRelation[] | undefined, max = 6): LinkRef[] {
  if (!Array.isArray(relations)) return [];
  const seen = new Set<string>();
  const out: LinkRef[] = [];
  for (const rel of relations) {
    if (rel?.["target-type"] !== "url") continue;
    const type = str(rel?.type).trim();
    const url = str(rel?.url?.resource).trim();
    if (!type || !url || !USEFUL_LINK_TYPES.has(type) || seen.has(type)) continue;
    seen.add(type);
    out.push({ type, url });
    if (out.length >= max) break;
  }
  return out;
}

/** Ids on other services, read from every url link rather than the short list of display links. */
function mapExternalIds(relations: RawRelation[] | undefined): ExternalIds {
  const ids: ExternalIds = {};
  for (const rel of Array.isArray(relations) ? relations : []) {
    const url = str(rel?.url?.resource);
    ids.wikidata ??= url.match(/wikidata\.org\/wiki\/(Q\d+)/)?.[1];
    ids.discogs ??= url.match(/discogs\.com\/artist\/(\d+)/)?.[1];
    ids.genius ??= url.match(/genius\.com\/artists\/([^/?#]+)/)?.[1];
  }
  return Object.fromEntries(Object.entries(ids).filter(([, id]) => id)) as ExternalIds;
}

/** Cover Art Archive thumbnail URL for a release or release-group. */
export function coverArtUrl(
  kind: "release" | "release-group",
  id: string,
  size: 250 | 500 = 250
): string | null {
  if (!UUID_RE.test(id)) return null;
  return `${COVER_ART_BASE}/${kind}/${id}/front-${size}`;
}

// --- Search mappers (lightweight, for the picker dropdown) ------------------

export function mapRecording(raw: RawRecording): Song {
  const credits = Array.isArray(raw["artist-credit"]) ? raw["artist-credit"] : [];
  const releases = Array.isArray(raw.releases) ? raw.releases : [];
  return {
    id: str(raw.id),
    title: str(raw.title) || "Untitled recording",
    durationMs: typeof raw.length === "number" ? raw.length : null,
    disambiguation: str(raw.disambiguation),
    artists: credits
      .map((credit) => ({
        name: str(credit?.artist?.name) || str(credit?.name),
        id: optionalStr(credit?.artist?.id) ?? null,
      }))
      .filter((artist) => artist.name.length > 0),
    tags: mapTags(raw.tags),
    releases: releases
      .map((release) => ({
        id: str(release?.id),
        title: str(release?.title),
        date: str(release?.date),
      }))
      .filter((release) => release.title.length > 0)
      .slice(0, 5),
  };
}

export function mapArtist(raw: RawArtist): Artist {
  const lifeSpan = raw["life-span"] ?? {};
  return {
    id: str(raw.id),
    name: str(raw.name) || "Unknown artist",
    disambiguation: str(raw.disambiguation),
    country: str(raw.country),
    type: str(raw.type),
    tags: mapTags(raw.tags),
    lifeSpan: {
      begin: optionalStr(lifeSpan.begin),
      end: optionalStr(lifeSpan.end),
      ended: typeof lifeSpan.ended === "boolean" ? lifeSpan.ended : undefined,
    },
  };
}

// --- Lookup mappers (rich, for the comparison view) ------------------------

const STUDIO_ALBUM = (g: RawReleaseGroup) =>
  g?.["primary-type"] === "Album" &&
  (!Array.isArray(g?.["secondary-types"]) || g["secondary-types"].length === 0);

/** Browse payload for `release-group?artist=…&type=album`. */
type RawAlbumBrowse = { "release-group-count"?: unknown; "release-groups"?: RawReleaseGroup[] };

/**
 * Summarises an artist's albums from a release-group browse. `release-group-count` is the exact
 * total; the page holds at most ALBUM_PAGE_SIZE groups, so studio counts are a lower bound when
 * the artist has more albums than that (e.g. bands with hundreds of live bootlegs).
 */
export function mapDiscography(browse: RawAlbumBrowse | null | undefined): Discography | null {
  if (!browse || !Array.isArray(browse["release-groups"])) return null;
  const groups = browse["release-groups"].filter((g) => g?.["primary-type"] === "Album");
  const total = typeof browse["release-group-count"] === "number" ? browse["release-group-count"] : groups.length;
  const studio = groups.filter(STUDIO_ALBUM);

  const yearsOf = (list: RawReleaseGroup[]) =>
    list.map((g) => yearOf(str(g?.["first-release-date"]))).filter(Boolean).sort();
  const years = studio.length ? yearsOf(studio) : yearsOf(groups);

  const representative: ReleaseRef[] = studio
    .map((g) => ({
      id: str(g?.id),
      title: str(g?.title),
      year: yearOf(str(g?.["first-release-date"])),
      type: str(g?.["primary-type"]) || "Album",
      artUrl: coverArtUrl("release-group", str(g?.id)),
    }))
    .filter((r) => r.id && r.title)
    .sort((a, b) => a.year.localeCompare(b.year))
    .slice(0, 6);

  return {
    albumCount: Math.max(total, groups.length),
    studioAlbumCount: studio.length,
    complete: groups.length >= total,
    firstYear: years[0] ?? "",
    lastYear: years[years.length - 1] ?? "",
    representative,
    ...(studio.length ? { studioTitles: studio.map((g) => str(g?.title)).filter(Boolean) } : {}),
  };
}

/** Maps an artist lookup plus its album browse (null when the browse failed). */
export function mapArtistDetails(raw: RawArtist, albums: RawAlbumBrowse | null = null): ArtistDetails {
  const relationships = (raw.relations ?? []).flatMap(relation => relation.artist && UUID_RE.test(str(relation.artist.id)) ? [{
    artist: mapArtist(relation.artist), type: str(relation.type), direction: optionalStr(relation.direction),
    begin: optionalStr(relation.begin), end: optionalStr(relation.end),
    ended: typeof relation.ended === 'boolean' ? relation.ended : undefined,
  }] : []);
  const externalIds = mapExternalIds(raw.relations);
  return {
    ...mapArtist(raw),
    gender: str(raw.gender),
    area: str(raw.area?.name) || str(raw["begin-area"]?.name),
    genres: mapCounted(raw.genres),
    rating: mapRating(raw.rating),
    links: mapLinks(raw.relations),
    discography: mapDiscography(albums),
    ...(relationships.length ? { relationships } : {}),
    ...(Object.keys(externalIds).length ? { externalIds } : {}),
  };
}

export function mapRecordingDetails(raw: RawRecording): RecordingDetails {
  const base = mapRecording(raw);
  const releases = Array.isArray(raw.releases) ? raw.releases : [];

  // Earliest dated official-ish release is the most representative.
  const dated = releases
    .map((r) => ({
      id: str(r?.id),
      title: str(r?.title),
      date: str(r?.date),
      rgId: str(r?.["release-group"]?.id),
    }))
    .filter((r) => r.id && r.title);
  dated.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  const pick = dated[0] ?? null;

  const representative: ReleaseRef | null = pick
    ? {
        id: pick.id,
        title: pick.title,
        year: yearOf(pick.date),
        type: "Release",
        artUrl: coverArtUrl("release", pick.id),
      }
    : null;

  return {
    ...base,
    genres: mapCounted(raw.genres),
    rating: mapRating(raw.rating),
    firstReleaseDate: str(raw["first-release-date"]),
    representative,
    links: mapLinks(raw.relations),
  };
}

// --- Mutual collaborators ----------------------------------------------------

/** MusicBrainz recording relationship types we show, and the label each gets. */
const CREDIT_ROLES: Record<string, string> = {
  producer: "producer",
  "co-producer": "producer",
  programming: "programming",
  mix: "mixing",
  engineer: "engineering",
  recording: "engineering",
  vocal: "vocals",
  instrument: "instruments",
  "performing orchestra": "instruments",
};
/** Placeholder artists MusicBrainz uses for compilations and unknown credits. */
const SPECIAL_ARTISTS = new Set([
  "89ad4ac3-39f7-470e-963a-56509c546377", // Various Artists
  "125ec42a-7229-4250-afc5-e057484327fe", // [unknown]
]);
/** Songwriting credits live on the work a recording performs, not on the recording. */
const WORK_ROLES = new Set(["writer", "composer", "lyricist", "librettist"]);
const RECORDING_PAGE_SIZE = 100;
/** Most recent studio albums read per artist when looking for shared collaborators. */
const ALBUMS_FOR_CREDITS = 25;
/** Editions read per album: their credits are combined, since any one can be poorly credited. */
const EDITIONS_FOR_CREDITS = 5;
/** Time for one artist's scan, so two artists fit the route's 60 s. Albums already read stay cached. */
const CREDIT_SCAN_BUDGET_MS = 20_000;
/** People listed per comparison. */
const MAX_MUTUAL = 30;

type Person = {
  name: string;
  roles: Set<string>;
  tracks: Map<string, string>;
  /** The tracks they did more on than write: played, sang, produced, mixed. */
  worked: Map<string, string>;
  titles: Set<string>;
  years: Set<string>;
};
/** Everyone credited on one artist's scanned recordings, keyed by MusicBrainz artist id. */
export type CreditIndex = { coverage: Coverage; people: Map<string, Person> };

/**
 * Indexes recordings (with artist-credits + artist-rels): who appears on the artist's
 * recordings, in what role, on which tracks. Co-credited artists count as "featured".
 * `coverage` says how much of the catalogue these recordings represent.
 */
export function indexCredits(recordings: RawRecording[], selfId: string, coverage: Coverage): CreditIndex {
  const people = new Map<string, Person>();

  const credit = (rawId: unknown, rawName: unknown, role: string, rec: RawRecording) => {
    const id = str(rawId);
    const name = str(rawName);
    if (!id || !name || id === selfId || SPECIAL_ARTISTS.has(id)) return;
    const person = people.get(id) ?? { name, roles: new Set<string>(), tracks: new Map<string, string>(), worked: new Map<string, string>(), titles: new Set<string>(), years: new Set<string>() };
    person.roles.add(role);
    // Editions can hold different recordings of one song; a song counts once per person.
    const title = str(rec.title) || "Untitled recording";
    if (role !== "songwriting") person.worked.set(str(rec.id), title);
    if (!person.titles.has(normTitle(title))) {
      person.titles.add(normTitle(title));
      person.tracks.set(str(rec.id), title);
    }
    const year = yearOf(str(rec["first-release-date"]));
    if (year) person.years.add(year);
    people.set(id, person);
  };

  for (const rec of recordings) {
    if (!str(rec?.id)) continue;
    for (const c of Array.isArray(rec["artist-credit"]) ? rec["artist-credit"] : []) {
      credit(c?.artist?.id, c?.artist?.name, "featured", rec);
    }
    for (const rel of Array.isArray(rec.relations) ? rec.relations : []) {
      const role = CREDIT_ROLES[str(rel?.type)];
      if (role) credit(rel?.artist?.id, rel?.artist?.name, role, rec);
      for (const writer of rel?.work?.relations ?? []) {
        if (WORK_ROLES.has(str(writer?.type))) credit(writer?.artist?.id, writer?.artist?.name, "songwriting", rec);
      }
    }
  }

  return { coverage, people };
}

type RawTrack = { "artist-credit"?: RawArtistCredit[]; recording?: RawRecording | null };
type RawReleaseWithTracks = { media?: { tracks?: RawTrack[] }[]; relations?: RawRelation[] };

/**
 * The recordings on a release's tracklist, each carrying its track-level artist credit. A credit on
 * the release itself (say, a producer of the whole album) applies to every track, so it's added to each.
 */
export function releaseRecordings(release: RawReleaseWithTracks | null | undefined): RawRecording[] {
  const albumWide = (release?.relations ?? []).filter((rel) => rel?.artist);
  return (release?.media ?? []).flatMap((medium) =>
    (medium?.tracks ?? []).flatMap((track) =>
      track?.recording
        ? [{
            ...track.recording,
            "artist-credit": track["artist-credit"] ?? track.recording["artist-credit"],
            relations: [...(track.recording.relations ?? []), ...albumWide],
          }]
        : []
    )
  );
}

/** Keeps only what the credit index reads: an album's raw response can be close to a megabyte. */
function compactRecording(rec: RawRecording, firstReleaseDate: unknown): RawRecording {
  const person = (artist: RawArtist | null | undefined) => ({ id: artist?.id, name: artist?.name });
  return {
    id: rec.id,
    title: rec.title,
    "first-release-date": firstReleaseDate,
    "artist-credit": (rec["artist-credit"] ?? []).map((c) => ({ artist: person(c?.artist) })),
    relations: (rec.relations ?? []).flatMap((rel): RawRelation[] => {
      if (CREDIT_ROLES[str(rel?.type)]) return [{ type: rel.type, artist: person(rel.artist) }];
      const writers = (rel?.work?.relations ?? []).filter((w) => WORK_ROLES.has(str(w?.type)));
      return writers.length
        ? [{ type: rel.type, work: { relations: writers.map((w) => ({ type: w.type, artist: person(w.artist) })) } }]
        : [];
    }),
  };
}

const yearSpan = (person: Person): YearSpan | null => {
  const years = [...person.years].sort();
  return years.length ? { first: years[0], last: years[years.length - 1] } : null;
};

/** People credited on both artists' recordings, strongest overlap first, plus direct links. */
export function compareCredits(
  a: CreditIndex,
  b: CreditIndex,
  aId: string,
  bId: string,
  max = MAX_MUTUAL,
  tracksPerSide = 5
): CollaboratorComparison {
  const refs = (tracks: Map<string, string> | undefined): TrackRef[] =>
    [...(tracks ?? [])].slice(0, tracksPerSide).map(([id, title]) => ({ id, title }));

  const mutual: Collaborator[] = [...a.people]
    .filter(([id]) => id !== aId && id !== bId && b.people.has(id))
    .map(([id, pa]) => {
      const pb = b.people.get(id)!;
      return {
        id,
        name: pa.name,
        roles: { a: [...pa.roles].sort(), b: [...pb.roles].sort() },
        trackCount: { a: pa.tracks.size, b: pb.tracks.size },
        tracks: { a: refs(pa.tracks), b: refs(pb.tracks) },
        years: { a: yearSpan(pa), b: yearSpan(pb) },
      };
    })
    .sort(
      (x, y) =>
        Math.min(y.trackCount.a, y.trackCount.b) - Math.min(x.trackCount.a, x.trackCount.b) ||
        y.trackCount.a + y.trackCount.b - (x.trackCount.a + x.trackCount.b) ||
        x.name.localeCompare(y.name)
    )
    .slice(0, max);

  const writerOnly = (person: Person | undefined) =>
    new Map([...(person?.tracks ?? [])].filter(([id]) => !person?.worked.has(id)));

  return {
    mutual,
    direct: { bOnA: refs(a.people.get(bId)?.worked), aOnB: refs(b.people.get(aId)?.worked) },
    writing: { bOnA: refs(writerOnly(a.people.get(bId))), aOnB: refs(writerOnly(b.people.get(aId))) },
    coverage: { a: a.coverage, b: b.coverage },
  };
}

// --- Request validation -----------------------------------------------------

export type SearchParams = { type: SearchType; query: string; limit: number };
export type DetailsParams = { type: SearchType; id: string };

/** Validates and normalizes search params. Throws ValidationError on bad input. */
export function parseSearchParams(params: URLSearchParams): SearchParams {
  const type = parseType(params.get("type"));

  const query = (params.get("q") ?? "").trim();
  if (query.length < MIN_QUERY_LENGTH) {
    throw new ValidationError(
      `Query must be at least ${MIN_QUERY_LENGTH} characters.`
    );
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new ValidationError(
      `Query must be at most ${MAX_QUERY_LENGTH} characters.`
    );
  }

  let limit = DEFAULT_LIMIT;
  const rawLimit = params.get("limit");
  if (rawLimit != null) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isFinite(parsed)) {
      limit = Math.min(Math.max(parsed, 1), MAX_LIMIT);
    }
  }

  return { type, query, limit };
}

export type CollaboratorParams = { a: string; b: string };

/** Validates the two artist ids for a collaborator comparison. */
export function parseCollaboratorParams(params: URLSearchParams): CollaboratorParams {
  const a = (params.get("a") ?? "").trim();
  const b = (params.get("b") ?? "").trim();
  if (!UUID_RE.test(a) || !UUID_RE.test(b)) {
    throw new ValidationError('Query params "a" and "b" must be MusicBrainz artist UUIDs.');
  }
  if (a.toLowerCase() === b.toLowerCase()) {
    throw new ValidationError("Pick two different artists.");
  }
  return { a, b };
}

/** Validates and normalizes details (lookup) params. */
export function parseDetailsParams(params: URLSearchParams): DetailsParams {
  const type = parseType(params.get("type"));
  const id = (params.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) {
    throw new ValidationError('Query param "id" must be a MusicBrainz UUID.');
  }
  return { type, id };
}

function parseType(raw: string | null): SearchType {
  if (raw !== "recording" && raw !== "artist") {
    throw new ValidationError(
      'Query param "type" must be "recording" or "artist".'
    );
  }
  return raw;
}

// --- Outbound request core: throttle + dedup + backoff + SWR cache ----------

// Best-effort serialized throttle (per instance — see caveat at top of file).
let throttleChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function scheduleThrottled(spacingMs: number): Promise<void> {
  const run = throttleChain.then(async () => {
    const wait = spacingMs - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  throttleChain = run.catch(() => {});
  return run;
}

type CacheEntry = { freshUntil: number; staleUntil: number; data: unknown };
const cache = new Map<string, CacheEntry>();
// Collapses concurrent identical upstream requests into one in-flight promise.
const inFlight = new Map<string, Promise<unknown>>();

/** Clears cache + in-flight state. Intended for tests. */
export function __clearCache(): void {
  cache.clear();
  inFlight.clear();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  const exp = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
  return Math.round(exp * (0.5 + Math.random() * 0.5)); // full-ish jitter
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers?.get?.("retry-after");
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

export type RequestOptions = {
  /** Injectable fetch for testing. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Min spacing between upstream calls. Defaults to ~1 req/sec. */
  throttleMs?: number;
  /** Whether to use the SWR cache. Defaults to true. */
  useCache?: boolean;
  /** Max retries on retryable upstream failures. Defaults to 2. */
  maxRetries?: number;
  /** Base backoff used between retries (tests pass 0). Defaults to 500ms. */
  retryBaseMs?: number;
  /** Time allowed for one artist's credit scan. Defaults to CREDIT_SCAN_BUDGET_MS. */
  scanBudgetMs?: number;
};

/**
 * Fetches and parses JSON from MusicBrainz with the required User-Agent, a
 * timeout, bounded exponential backoff + jitter on retryable failures
 * (429/503/network/timeout, honoring Retry-After), and in-flight de-duplication
 * so concurrent identical requests share a single upstream call.
 */
async function fetchJson(
  url: string,
  options: RequestOptions
): Promise<unknown> {
  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = fetchJsonUncoalesced(url, options);
  inFlight.set(url, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(url);
  }
}

async function fetchJsonUncoalesced(
  url: string,
  options: RequestOptions
): Promise<unknown> {
  const {
    fetchImpl = fetch,
    throttleMs = MIN_REQUEST_SPACING_MS,
    maxRetries = MAX_RETRIES,
    retryBaseMs = RETRY_BASE_MS,
  } = options;

  let lastError: UpstreamError = new UpstreamError("Could not reach MusicBrainz.", 502, true);
  // Retry-After (ms) carried from a failing attempt into the next delay.
  let pendingRetryAfter: number | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const base = retryBaseMs === 0 ? 0 : backoffDelay(attempt - 1);
      await delay(Math.max(pendingRetryAfter ?? 0, base));
      pendingRetryAfter = null;
    }
    if (throttleMs > 0) await scheduleThrottled(throttleMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      lastError = timedOut
        ? new UpstreamError("MusicBrainz request timed out.", 504, true)
        : new UpstreamError("Could not reach MusicBrainz.", 502, true);
      continue; // retryable
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429 || response.status === 503) {
      pendingRetryAfter = retryAfterMs(response);
      lastError = new UpstreamError(
        "MusicBrainz is busy right now. Please try again in a moment.",
        503,
        true
      );
      continue; // retryable
    }
    if (!response.ok) {
      // Non-retryable upstream error (4xx/5xx other than rate limiting).
      throw new UpstreamError(
        `MusicBrainz returned an error (${response.status}).`,
        502,
        false
      );
    }

    try {
      return await response.json();
    } catch {
      throw new UpstreamError(
        "MusicBrainz returned a malformed response.",
        502,
        false
      );
    }
  }

  throw lastError;
}

export async function withCache<T>(
  key: string,
  ttl: number,
  useCache: boolean,
  producer: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  if (useCache) {
    const hit = cache.get(key);
    if (hit && hit.freshUntil > now) return hit.data as T;
    try {
      const data = await producer();
      cache.set(key, { freshUntil: now + ttl, staleUntil: now + STALE_TTL_MS, data });
      return data;
    } catch (error) {
      // Stale-while-revalidate: serve stale data if we have it and upstream
      // failed in a retryable way, rather than erroring the user.
      const stale = cache.get(key);
      if (stale && stale.staleUntil > now && error instanceof UpstreamError && error.retryable) {
        return stale.data as T;
      }
      throw error;
    }
  }
  return producer();
}

function buildSearchUrl({ type, query, limit }: SearchParams): string {
  const search = new URLSearchParams({
    query, // URLSearchParams encodes special characters safely
    fmt: "json",
    limit: String(limit),
  });
  return `${MB_BASE}/${type}?${search.toString()}`;
}

function buildLookupUrl({ type, id }: DetailsParams): string {
  // Artist lookups skip release-groups: they're capped at 25 there. Albums come from a browse.
  const inc =
    type === "artist"
      ? "genres+tags+ratings+url-rels+artist-rels"
      : "genres+tags+ratings+artist-credits+releases+release-groups+url-rels";
  return `${MB_BASE}/${type}/${id}?inc=${inc}&fmt=json`;
}

/** Browse of an artist's album release-groups; carries the exact total in release-group-count. */
function buildAlbumBrowseUrl(artistId: string): string {
  return `${MB_BASE}/release-group?artist=${artistId}&type=album&limit=${ALBUM_PAGE_SIZE}&fmt=json`;
}

/** Searches MusicBrainz for recordings or artists and returns normalized results. */
export async function searchMusicBrainz(
  input: SearchParams,
  options: RequestOptions = {}
): Promise<Result[]> {
  const { useCache = true } = options;
  const key = `search:${input.type}:${input.limit}:${input.query.toLowerCase()}`;
  return withCache(key, SEARCH_TTL_MS, useCache, async () => {
    const payload = await fetchJson(buildSearchUrl(input), options);
    return extractResults(input.type, payload);
  });
}

/** Server-only neighborhood requests share the existing cache, throttle and retry policy. */
export function musicBrainzContext<T>(path: string, params: Record<string, string>, options: RequestOptions = {}): Promise<T> {
  const query = new URLSearchParams({ ...params, fmt: 'json' });
  const url = `${MB_BASE}/${path}?${query}`;
  return withCache(`context:${url}`, params.query ? SEARCH_TTL_MS : LOOKUP_TTL_MS, options.useCache ?? true,
    async () => await fetchJson(url, options) as T);
}

/** Looks up a single artist/recording and returns the enriched comparison data. */
export async function lookupMusicBrainz(
  input: DetailsParams,
  options: RequestOptions = {}
): Promise<DetailsResult> {
  const { useCache = true } = options;
  const key = `lookup:${input.type}:${input.id}`;
  return withCache(key, LOOKUP_TTL_MS, useCache, async () => {
    const payload = await fetchJson(buildLookupUrl(input), options);
    if (input.type !== "artist") return mapRecordingDetails(payload as RawRecording);

    // Second call for accurate album counts. If only this one fails, still return the artist.
    let albums: RawAlbumBrowse | null = null;
    try {
      albums = await albumBrowse(input.id, options);
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
      console.warn(`[musicbrainz] album browse failed for ${input.id}: ${error.message}`);
    }
    return mapArtistDetails(payload as RawArtist, albums);
  });
}

/** An artist's album release-groups, cached: shared by the details card and the collaborator scan. */
function albumBrowse(artistId: string, options: RequestOptions): Promise<RawAlbumBrowse> {
  return withCache(`albums:${artistId}`, LOOKUP_TTL_MS, options.useCache ?? true, async () =>
    (await fetchJson(buildAlbumBrowseUrl(artistId), options)) as RawAlbumBrowse
  );
}

/** Recordings by an artist with everyone credited on them (one page of 100). */
function buildRecordingCreditsUrl(artistId: string): string {
  return `${MB_BASE}/recording?artist=${artistId}&inc=artist-credits+artist-rels&limit=${RECORDING_PAGE_SIZE}&fmt=json`;
}

/** Official editions of a release-group, with every track's credits, album credits and songwriters. */
function buildAlbumCreditsUrl(releaseGroupId: string): string {
  return `${MB_BASE}/release?release-group=${releaseGroupId}&status=official&inc=recordings+artist-credits+artist-rels+recording-level-rels+work-rels+work-level-rels&limit=${EDITIONS_FOR_CREDITS}&fmt=json`;
}

/** One album's credits across its editions; cached per album so a later scan can pick up from here. */
function albumRecordings(group: RawReleaseGroup, options: RequestOptions): Promise<RawRecording[]> {
  const id = str(group.id);
  return withCache(`album-credits:${id}`, LOOKUP_TTL_MS, options.useCache ?? true, async () => {
    const page = (await fetchJson(buildAlbumCreditsUrl(id), options)) as { releases?: RawReleaseWithTracks[] };
    return (page.releases ?? []).flatMap(releaseRecordings).map((rec) => compactRecording(rec, group["first-release-date"]));
  });
}

/**
 * Who is credited on an artist's work. Reads the credits of their studio albums, newest first (one
 * request each), until the albums or the time budget run out; artists without studio albums fall
 * back to one page of their recordings. A failure after the first album keeps what was read.
 */
async function artistCredits(artistId: string, options: RequestOptions): Promise<CreditIndex> {
  const studio = ((await albumBrowse(artistId, options))["release-groups"] ?? [])
    .filter(STUDIO_ALBUM)
    .filter((g) => UUID_RE.test(str(g?.id)))
    .sort((x, y) => str(y?.["first-release-date"]).localeCompare(str(x?.["first-release-date"])));

  if (!studio.length) {
    return withCache(`credits:${artistId}`, LOOKUP_TTL_MS, options.useCache ?? true, async () => {
      const page = (await fetchJson(buildRecordingCreditsUrl(artistId), options)) as {
        recordings?: RawRecording[];
        "recording-count"?: unknown;
      };
      const recordings = Array.isArray(page.recordings) ? page.recordings : [];
      const total = typeof page["recording-count"] === "number" ? page["recording-count"] : recordings.length;
      return indexCredits(recordings, artistId, { scanned: recordings.length, total, unit: "recordings" });
    });
  }

  const deadline = Date.now() + (options.scanBudgetMs ?? CREDIT_SCAN_BUDGET_MS);
  const recent = studio.slice(0, ALBUMS_FOR_CREDITS);
  const recordings: RawRecording[] = [];
  let scanned = 0;
  for (const group of recent) {
    if (scanned > 0 && Date.now() > deadline) break;
    try {
      recordings.push(...(await albumRecordings(group, options)));
      scanned++;
    } catch (error) {
      if (scanned === 0 || !(error instanceof UpstreamError)) throw error;
      console.warn(`[musicbrainz] credit scan stopped for ${artistId}: ${error.message}`);
      break;
    }
  }
  return indexCredits(recordings, artistId, {
    scanned,
    total: studio.length,
    unit: "albums",
    ...(scanned < recent.length ? { partial: true } : {}),
  });
}

/**
 * Collaborators shared by two artists. Costs up to ALBUMS_FOR_CREDITS requests per artist
 * (plus the album list the details card already cached), each cached afterwards.
 */
export async function compareCollaborators(
  input: CollaboratorParams,
  options: RequestOptions = {}
): Promise<CollaboratorComparison> {
  const a = await artistCredits(input.a, options);
  const b = await artistCredits(input.b, options);
  return compareCredits(a, b, input.a, input.b);
}

const normTitle = (title: string) =>
  title
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s*[([](feat|ft|with)\.?[^)\]]*[)\]]/g, "")
    .replace(/\s+-\s+.*(remaster|version|edit|mix).*$/i, "")
    .trim();

/** An artist's recordings with this exact title (ignoring "feat." and remaster suffixes). */
export async function findRecordings(
  artistId: string,
  title: string,
  options: RequestOptions = {}
): Promise<Song[]> {
  const clean = normTitle(title);
  if (!UUID_RE.test(artistId) || !clean) return [];
  const query = `recording:"${clean.replace(/["\\]/g, "")}" AND arid:${artistId} AND status:official`;
  const results = (await searchMusicBrainz({ type: "recording", query, limit: 10 }, options)) as Song[];
  return results.filter((song) => normTitle(song.title) === clean);
}

/** The first of those, or null. */
export async function findRecording(artistId: string, title: string, options: RequestOptions = {}): Promise<Song | null> {
  return (await findRecordings(artistId, title, options))[0] ?? null;
}

/** Pulls the right array out of a search payload and maps it; tolerant of missing keys. */
export function extractResults(type: SearchType, payload: unknown): Result[] {
  const root = (payload ?? {}) as Record<string, unknown>;
  if (type === "recording") {
    const list = Array.isArray(root.recordings) ? root.recordings : [];
    return list
      .map((item) => mapRecording(item as RawRecording))
      .filter((song) => song.id.length > 0);
  }
  const list = Array.isArray(root.artists) ? root.artists : [];
  return list
    .map((item) => mapArtist(item as RawArtist))
    .filter((artist) => artist.id.length > 0);
}
