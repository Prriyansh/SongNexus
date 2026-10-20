// Shared domain types + pure helpers used by both the API layer and the UI.
// Keeping these in one place avoids the frontend and the route drifting apart.

export type Mode = "songs" | "artists";

export type Artist = {
  id: string;
  name: string;
  disambiguation: string;
  country: string;
  type: string;
  tags: string[];
  lifeSpan: { begin?: string; end?: string; ended?: boolean };
};

export type Song = {
  id: string;
  title: string;
  durationMs: number | null;
  disambiguation: string;
  artists: { name: string; id: string | null }[];
  tags: string[];
  releases: { id: string; title: string; date: string }[];
};

export type Result = Song | Artist;

// --- Enriched detail types (from MusicBrainz lookup, not search) ------------

/** A curated MusicBrainz genre with its community vote count. */
export type Genre = { name: string; count: number };

/** A MusicBrainz community rating (1–5) with the number of votes behind it. */
export type Rating = { value: number; votes: number };

/** A representative release with an optional Cover Art Archive thumbnail. */
export type ReleaseRef = {
  id: string;
  title: string;
  year: string;
  type: string;
  /** Cover Art Archive URL, or null when no art is catalogued. */
  artUrl: string | null;
};

/** An external link (streaming, official site, database) from url-rels. */
export type LinkRef = { type: string; url: string };

/**
 * Album summary from a browse of the artist's album release-groups.
 * (An artist *lookup* only returns the first 25 release-groups, so it can't be used for counts.)
 */
export type Discography = {
  /** Every album-type release-group: studio, live, compilation, remix, demo. Exact. */
  albumCount: number;
  /** Studio albums (no secondary type). A lower bound when `complete` is false. */
  studioAlbumCount: number;
  /** False when the artist has more albums than one page, so studio counts may be low. */
  complete: boolean;
  /** Year span of the studio albums (falls back to all albums). */
  firstYear: string;
  lastYear: string;
  /** Up to a handful of representative studio albums, oldest first. */
  representative: ReleaseRef[];
};

export type ArtistDetails = Artist & {
  gender: string;
  area: string;
  genres: Genre[];
  rating: Rating | null;
  /** Null when the album browse failed; the rest of the details are still usable. */
  discography: Discography | null;
  links: LinkRef[];
};

export type RecordingDetails = Song & {
  genres: Genre[];
  rating: Rating | null;
  firstReleaseDate: string;
  representative: ReleaseRef | null;
  links: LinkRef[];
};

export type DetailsResult = ArtistDetails | RecordingDetails;

/** A recording, as listed under a collaborator. */
export type TrackRef = { id: string; title: string };

/** Someone credited on recordings by both artists (producer, featured artist, mixer…). */
export type Collaborator = {
  id: string;
  name: string;
  /** Their roles on each artist's recordings, e.g. ["producer", "instruments"]. */
  roles: { a: string[]; b: string[] };
  /** How many scanned recordings of each artist credit them. */
  trackCount: { a: number; b: number };
  /** A few of those recordings per artist. */
  tracks: { a: TrackRef[]; b: TrackRef[] };
};

/**
 * What a collaborator scan covered: the artist's most recent studio albums (unit "albums"), or,
 * for artists without studio albums, one page of their recordings (unit "recordings").
 */
export type Coverage = { scanned: number; total: number; unit: "albums" | "recordings" };

export type CollaboratorComparison = {
  mutual: Collaborator[];
  /** Recordings where one artist is credited on the other's catalogue. */
  direct: { bOnA: TrackRef[]; aOnB: TrackRef[] };
  /** How much of each catalogue was scanned. */
  coverage: { a: Coverage; b: Coverage };
};

/** An artist's most popular track (ranked by Deezer), matched to a MusicBrainz recording. */
export type TopTrack = Song & { source: "Deezer" };

/** Narrows a Result to a Song. Songs have a `title`; artists have a `name`. */
export function isSong(result: Result): result is Song {
  return "title" in result;
}

/** Narrows detail results the same way (RecordingDetails carry a `title`). */
export function isRecordingDetails(
  result: DetailsResult
): result is RecordingDetails {
  return "title" in result;
}

/** Formats a MusicBrainz duration (ms) as m:ss, or a clear fallback when absent. */
export function formatDuration(ms: number | null): string {
  if (ms == null) return "Not available";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Tags present on both results, preserving the order of the first. */
export function sharedTags(first: Result, second: Result): string[] {
  const secondSet = new Set(second.tags);
  return first.tags.filter((tag) => secondSet.has(tag));
}

/**
 * Splits two genre lists into shared vs. each side's distinct genres. Order
 * follows each input list (already vote-sorted by the mapper), so the most
 * significant genres surface first.
 */
export function partitionGenres(
  a: Genre[],
  b: Genre[]
): { shared: string[]; onlyA: string[]; onlyB: string[] } {
  const aNames = a.map((g) => g.name);
  const bNames = b.map((g) => g.name);
  const aSet = new Set(aNames);
  const bSet = new Set(bNames);
  return {
    shared: aNames.filter((name) => bSet.has(name)),
    onlyA: aNames.filter((name) => !bSet.has(name)),
    onlyB: bNames.filter((name) => !aSet.has(name)),
  };
}

/** Formats an active-years range like "1991 – present" or "1991 – 2011". */
export function formatYears(begin: string, end: string, ended?: boolean): string {
  const from = begin || "Unknown";
  if (end) return `${from} – ${end}`;
  if (ended) return from; // ended but no end date recorded
  return begin ? `${from} – present` : "Unknown";
}
