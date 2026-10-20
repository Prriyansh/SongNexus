// Small, reusable MusicBrainz integration layer shared by both comparison
// features. Keeps all upstream knowledge (endpoints, schema, rate limits,
// User-Agent) out of the UI and the route handler.
//
// MusicBrainz API docs: https://musicbrainz.org/doc/MusicBrainz_API
// - Requires a descriptive, identifiable User-Agent.
// - Asks clients to average no more than ~1 request/second per IP.
// - Search endpoints do not accept `inc=`; tags are returned when indexed.

import type { Artist, Result, Song } from "./types";

export type SearchType = "recording" | "artist";

const MB_BASE = "https://musicbrainz.org/ws/2";
// Identifiable User-Agent as required by MusicBrainz. The repo URL is a valid
// point of contact; no secrets are involved.
const USER_AGENT =
  "SongNexus/1.0.0 (https://github.com/Prriyansh/SongNexus)";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
const REQUEST_TIMEOUT_MS = 10_000;
const MIN_REQUEST_SPACING_MS = 1_100; // stay under 1 req/sec
const CACHE_TTL_MS = 60_000;

/** Thrown for bad client input; maps to HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Thrown when MusicBrainz itself fails; carries a status to surface upstream. */
export class UpstreamError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

// --- Raw upstream shapes (only the fields we read) -------------------------

type RawTag = { name?: unknown; count?: unknown };

type RawArtistCredit = {
  name?: unknown;
  artist?: { id?: unknown; name?: unknown } | null;
};

type RawRelease = { id?: unknown; title?: unknown; date?: unknown };

type RawRecording = {
  id?: unknown;
  title?: unknown;
  length?: unknown;
  disambiguation?: unknown;
  "artist-credit"?: RawArtistCredit[];
  tags?: RawTag[];
  releases?: RawRelease[];
};

type RawArtist = {
  id?: unknown;
  name?: unknown;
  disambiguation?: unknown;
  country?: unknown;
  type?: unknown;
  tags?: RawTag[];
  "life-span"?: { begin?: unknown; end?: unknown; ended?: unknown } | null;
};

// --- Small safe coercion helpers -------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Normalizes MusicBrainz tags: drops blanks, keeps only tags with a positive
 * vote count (negative/zero are disputed or unvoted noise), sorts by votes,
 * dedupes, and caps the list so the UI stays readable.
 */
function mapTags(tags: RawTag[] | undefined, max = 8): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  return tags
    .map((tag) => ({
      name: str(tag?.name).trim().toLowerCase(),
      count: typeof tag?.count === "number" ? tag.count : 0,
    }))
    .filter((tag) => tag.name.length > 0 && tag.count > 0)
    .sort((a, b) => b.count - a.count)
    .filter((tag) => (seen.has(tag.name) ? false : (seen.add(tag.name), true)))
    .slice(0, max)
    .map((tag) => tag.name);
}

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

// --- Request validation -----------------------------------------------------

export type SearchParams = { type: SearchType; query: string; limit: number };

/** Validates and normalizes raw query params. Throws ValidationError on bad input. */
export function parseSearchParams(params: URLSearchParams): SearchParams {
  const rawType = params.get("type");
  if (rawType !== "recording" && rawType !== "artist") {
    throw new ValidationError(
      'Query param "type" must be "recording" or "artist".'
    );
  }

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

  return { type: rawType, query, limit };
}

// --- Outbound request: throttle + cache + fetch -----------------------------

// Serialized throttle so concurrent callers never burst past the MusicBrainz
// rate limit. Module-level state is per server instance, which is the right
// granularity (the limit is per IP).
let throttleChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function scheduleThrottled(spacingMs: number): Promise<void> {
  const run = throttleChain.then(async () => {
    const wait = spacingMs - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  // Swallow rejections on the chain itself so one failure can't wedge the queue.
  throttleChain = run.catch(() => {});
  return run;
}

type CacheEntry = { expires: number; results: Result[] };
const cache = new Map<string, CacheEntry>();

/** Clears the in-memory response cache. Intended for tests. */
export function __clearCache(): void {
  cache.clear();
}

export type SearchOptions = {
  /** Injectable fetch for testing. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Min spacing between upstream calls. Defaults to ~1 req/sec. */
  throttleMs?: number;
  /** Whether to use the short-lived response cache. Defaults to true. */
  useCache?: boolean;
};

function buildUrl({ type, query, limit }: SearchParams): string {
  const search = new URLSearchParams({
    query, // URLSearchParams encodes special characters safely
    fmt: "json",
    limit: String(limit),
  });
  return `${MB_BASE}/${type}?${search.toString()}`;
}

/**
 * Searches MusicBrainz for recordings or artists and returns normalized results.
 * Handles the User-Agent requirement, timeouts, rate limiting, upstream errors
 * and malformed payloads. Deduplicates identical searches within a short window.
 */
export async function searchMusicBrainz(
  input: SearchParams,
  options: SearchOptions = {}
): Promise<Result[]> {
  const {
    fetchImpl = fetch,
    throttleMs = MIN_REQUEST_SPACING_MS,
    useCache = true,
  } = options;

  const cacheKey = `${input.type}:${input.limit}:${input.query.toLowerCase()}`;
  if (useCache) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.results;
  }

  if (throttleMs > 0) await scheduleThrottled(throttleMs);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(buildUrl(input), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new UpstreamError("MusicBrainz request timed out.", 504);
    }
    throw new UpstreamError("Could not reach MusicBrainz.", 502);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 503 || response.status === 429) {
    throw new UpstreamError(
      "MusicBrainz is rate limiting requests. Please try again shortly.",
      503
    );
  }
  if (!response.ok) {
    throw new UpstreamError(
      `MusicBrainz returned an error (${response.status}).`,
      502
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new UpstreamError("MusicBrainz returned a malformed response.", 502);
  }

  const results = extractResults(input.type, payload);
  if (useCache) {
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, results });
  }
  return results;
}

/** Pulls the right array out of a payload and maps it; tolerant of missing keys. */
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
