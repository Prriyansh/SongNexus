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
  DetailsResult,
  Genre,
  LinkRef,
  Rating,
  RecordingDetails,
  ReleaseRef,
  Result,
  Song,
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

export function mapArtistDetails(raw: RawArtist): ArtistDetails {
  const base = mapArtist(raw);
  const rgs = Array.isArray(raw["release-groups"]) ? raw["release-groups"] : [];

  let albumCount = 0,
    epCount = 0,
    singleCount = 0,
    otherCount = 0;
  const years: string[] = [];
  for (const g of rgs) {
    const type = str(g?.["primary-type"]);
    if (type === "Album") albumCount++;
    else if (type === "EP") epCount++;
    else if (type === "Single") singleCount++;
    else otherCount++;
    const y = yearOf(str(g?.["first-release-date"]));
    if (y) years.push(y);
  }
  years.sort();

  const representative: ReleaseRef[] = rgs
    .filter(STUDIO_ALBUM)
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
    ...base,
    gender: str(raw.gender),
    area: str(raw.area?.name) || str(raw["begin-area"]?.name),
    genres: mapCounted(raw.genres),
    rating: mapRating(raw.rating),
    links: mapLinks(raw.relations),
    discography: {
      albumCount,
      epCount,
      singleCount,
      otherCount,
      firstYear: years[0] ?? "",
      lastYear: years[years.length - 1] ?? "",
      representative,
    },
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

async function withCache<T>(
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
  const inc =
    type === "artist"
      ? "genres+tags+ratings+release-groups+url-rels"
      : "genres+tags+ratings+artist-credits+releases+release-groups+url-rels";
  return `${MB_BASE}/${type}/${id}?inc=${inc}&fmt=json`;
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

/** Looks up a single artist/recording and returns the enriched comparison data. */
export async function lookupMusicBrainz(
  input: DetailsParams,
  options: RequestOptions = {}
): Promise<DetailsResult> {
  const { useCache = true } = options;
  const key = `lookup:${input.type}:${input.id}`;
  return withCache(key, LOOKUP_TTL_MS, useCache, async () => {
    const payload = await fetchJson(buildLookupUrl(input), options);
    return input.type === "artist"
      ? mapArtistDetails(payload as RawArtist)
      : mapRecordingDetails(payload as RawRecording);
  });
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
