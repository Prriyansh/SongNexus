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
  /** Titles of the studio albums read, so other sources can pick albums over singles. */
  studioTitles?: string[];
};

export type ArtistDetails = Artist & {
  gender: string;
  area: string;
  genres: Genre[];
  rating: Rating | null;
  /** Null when the album browse failed; the rest of the details are still usable. */
  discography: Discography | null;
  links: LinkRef[];
  relationships?: ArtistRelationship[];
  /** This artist's ids elsewhere, from MusicBrainz's own url links, so other sources match exactly. */
  externalIds?: ExternalIds;
};

export type ExternalIds = { wikidata?: string; discogs?: string; genius?: string };

export type ArtistRelationship = {
  artist: Artist;
  type: string;
  direction?: string;
  begin?: string;
  end?: string;
  ended?: boolean;
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
  /** First and last year of the albums crediting them, per artist; null when undated. */
  years?: { a: YearSpan | null; b: YearSpan | null };
};

export type YearSpan = { first: string; last: string };

/**
 * What a collaborator scan covered: the artist's most recent studio albums (unit "albums"), or,
 * for artists without studio albums, one page of their recordings (unit "recordings").
 */
export type Coverage = {
  scanned: number;
  total: number;
  unit: "albums" | "recordings";
  /** True when time ran out or a request failed before the scan finished; asking again continues it. */
  partial?: boolean;
};

export type CollaboratorComparison = {
  mutual: Collaborator[];
  /** Recordings where one artist performed or worked on the other's catalogue. */
  direct: { bOnA: TrackRef[]; aOnB: TrackRef[] };
  /**
   * Recordings where one artist's only credit is as a songwriter. These can come from a sample or
   * interpolation of an older song, so they don't by themselves mean the two worked together.
   */
  writing?: { bOnA: TrackRef[]; aOnB: TrackRef[] };
  /** How much of each catalogue was scanned. */
  coverage: { a: Coverage; b: Coverage };
};

// --- Credits from sources other than MusicBrainz ------------------------------

export type CreditSource = "genius" | "discogs";

/** Where a credit was found: a song or release page anyone can open to check it. */
export type CreditEvidence = { title: string; url: string; year: string };

/** Someone one source credits on both artists' work. Ids only compare within that source. */
export type SourcedCollaborator = {
  source: CreditSource;
  id: string;
  name: string;
  url: string;
  roles: { a: string[]; b: string[] };
  count: { a: number; b: number };
  evidence: { a: CreditEvidence[]; b: CreditEvidence[] };
};

/**
 * What happened with one source. "no-key": no token is configured. "no-match": the artist couldn't
 * be identified there with confidence. "partial": time ran out or some requests failed.
 */
export type SourceReport = {
  source: string;
  status: "ok" | "partial" | "no-key" | "no-match" | "failed";
  scanned?: { a: number; b: number };
  unit?: "albums" | "songs";
};

export type MoreCredits = {
  collaborators: SourcedCollaborator[];
  /** Work where one source credits one artist on the other's release or song. */
  direct: (CreditEvidence & { source: CreditSource })[];
  sources: SourceReport[];
};

// --- Facts about one artist from reference sources ------------------------------

export type WikiLabelled = { id: string; name: string; year: string };

export type ArtistFacts = {
  wikidataUrl: string;
  description: string;
  /** First year of activity, as Wikidata records it. */
  activeFrom: string;
  awards: WikiLabelled[];
  nominations: WikiLabelled[];
  labels: WikiLabelled[];
  wikipedia: { url: string; extract: string; imageUrl: string | null } | null;
};

export type ArtistAudience = {
  listenBrainz: { listeners: number; listens: number; url: string } | null;
  lastFm: { listeners: number; plays: number; url: string } | null;
};

export type ArtistInsight = { id: string; facts: ArtistFacts | null; audience: ArtistAudience };

export type SimilarArtist = { name: string; mbid: string | null; url: string };

export type ArtistInsights = {
  a: ArtistInsight;
  b: ArtistInsight;
  shared: {
    awards: WikiLabelled[];
    labels: WikiLabelled[];
    /** Artists Last.fm lists as similar to both. Listener similarity, never a collaboration. */
    similarArtists: SimilarArtist[];
  };
  sources: SourceReport[];
};

// --- What's similar to an artist or song, for the Connection Web ------------------

export type SimilarReason = {
  /** listeners: played in the same sessions. related: listed by Deezer. style: shared tags. sound: calculated audio match. */
  kind: "listeners" | "related" | "style" | "sound";
  text: string;
  sourceUrl?: string;
};

export type SimilarNode = {
  kind: "artist" | "song";
  id: string;
  name: string;
  subtitle: string;
  artist?: string;
  imageUrl: string | null;
  /** 0–1, relative to the closest match on this map. Calculated, and drives the distance from the center. */
  similarity: number;
  /** Order to show them in when there isn't room for all. */
  rank: number;
  listeners: number | null;
  reasons: SimilarReason[];
};

/** "listeners": the two are played in the same sessions. "performed": the artist performs the song. */
export type SimilarLink = { from: string; to: string; kind: "listeners" | "performed" };

export type SimilarWeb = {
  center: SimilarNode;
  artists: SimilarNode[];
  songs: SimilarNode[];
  links: SimilarLink[];
  sources: SourceReport[];
  /** The songs the similar songs were found from. */
  seedSongs: string[];
};

// --- A map from one playlist, or a playlist and a friend's -----------------------

export type PlaylistSong = { title: string; artist: string };
export type TasteRequest = { mine: PlaylistSong[]; friend?: PlaylistSong[]; friendName?: string };

/**
 * mine / theirs: on one playlist only. shared: on both. for-me: on the friend's playlist, and close to
 * what I play. for-them: the reverse. new: on neither, and similar to what's there.
 */
export type TasteGroup = "mine" | "theirs" | "shared" | "for-me" | "for-them" | "new";

export type TasteNode = {
  kind: "artist" | "song";
  id: string;
  name: string;
  subtitle: string;
  artist?: string;
  /** MusicBrainz id when known, so it can be opened and explored. */
  mbid: string | null;
  imageUrl: string | null;
  group: TasteGroup;
  /** Songs on the playlists, or how many of the playlists' artists point to it. */
  weight: number;
  reasons: SimilarReason[];
};

export type TasteLink = { from: string; to: string; kind: "contains" | "similar" | "recommended" };

export type TasteMap = {
  nodes: TasteNode[];
  links: TasteLink[];
  stats: { mineSongs: number; mineArtists: number; friendSongs: number; friendArtists: number; sharedArtists: number; sharedSongs: number; similarLinks: number };
  sources: SourceReport[];
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
