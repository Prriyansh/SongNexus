// The contract every music service adapter implements, and the shapes the API returns for them.
// Types and constants only, so the frontend may import this file.

export const PROVIDER_IDS = ["spotify", "youtube", "apple-music", "lastfm", "listenbrainz", "soundcloud", "tidal", "shazam", "deezer", "amazon-music"] as const;
export type ProviderId = typeof PROVIDER_IDS[number];
export const isProviderId = (value: string): value is ProviderId => (PROVIDER_IDS as readonly string[]).includes(value);

/** What a source can do. Set from the provider's published API, never from what would be nice. */
export const CAPABILITIES = ["profile", "library", "playlists", "favorites", "followed_artists", "top_items", "recent_history", "now_playing", "sync_supported", "manual_import", "native_only"] as const;
export type Capability = typeof CAPABILITIES[number];
export type CapabilityInfo = {
  supported: boolean;
  /** Supported by the provider, but this connection wasn't granted the scope for it. */
  missingScope?: boolean;
  /** The limits a user should know about ("last 50 plays only"), or why it isn't supported. */
  note?: string;
};
export type Capabilities = Record<Capability, CapabilityInfo>;

/**
 * available: can be connected on this server. not_configured: the adapter works but this server has
 * no developer credentials for it. The rest can't be connected by anyone here, and say why.
 */
export type Availability = "available" | "not_configured" | "import_only" | "partner_access_required" | "native_only" | "unsupported";

/** open: may be combined with other sources once the user agrees. display_only: shown as-is, on its own. */
export type DataUse = "open" | "display_only";
export type DataPolicy = {
  use: DataUse;
  /** Stored provider data must be refreshed or deleted within this many days. */
  refreshWithinDays?: number;
  attribution: string;
  /** Plain statements of what the provider's terms mean for Song Nexus. */
  rules: string[];
  termsUrl: string;
  /** Where a user revokes access on the provider's side. */
  revokeUrl?: string;
};

export type AuthKind = "oauth" | "token" | "musickit" | "none";

export type ProviderDescriptor = {
  id: ProviderId;
  name: string;
  auth: AuthKind;
  availability: Availability;
  /** One or two sentences: what's needed, or why it can't be connected. */
  availabilityNote: string;
  capabilities: Capabilities;
  policy: DataPolicy;
  importFormats: string[];
  /** For token sign-in: what to ask for and where the user finds it. */
  tokenHelp?: { label: string; url: string };
  /** Never true in this repository: no adapter has been run against its live service with real credentials. */
  liveTested: boolean;
};

export type Credentials = {
  accessToken?: string;
  refreshToken?: string;
  /** Epoch milliseconds; absent when the token doesn't expire or the provider doesn't say. */
  expiresAt?: number;
  /** Provider-specific values, e.g. Last.fm's session key or the ListenBrainz user name. */
  extra?: Record<string, string>;
};
export type Profile = { id: string; name: string; url?: string };
export type Connected = { credentials: Credentials; profile: Profile; scopes: string[] };

export type EntityKind = "track" | "album" | "artist";
export type EntityInput = {
  kind: EntityKind;
  /** The source's own stable id for this item. */
  providerId: string;
  title: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  mbid?: string;
  url?: string;
  imageUrl?: string;
};

export type Relation = "saved" | "favorite" | "followed" | "top" | "recent";
export type PlaylistInput = {
  providerId: string;
  name: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  ownerName?: string;
  owned: boolean;
  trackCount?: number;
  /** Changes when the playlist's contents change (snapshot id, etag, modified date). */
  snapshot?: string;
};

/** One thing a sync step learned. The engine stores them; adapters never touch the database. */
export type Mutation =
  | { type: "library"; relation: Relation; period?: string; entity: EntityInput; addedAt?: string; position?: number }
  | { type: "playlist"; playlist: PlaylistInput }
  | { type: "playlist_items"; playlistId: string; offset: number; items: { entity: EntityInput; addedAt?: string }[] }
  /** The playlist's items are all stored: anything past `count` is removed and its snapshot marked synced. */
  | { type: "playlist_done"; playlistId: string; count: number }
  | { type: "play"; entity: EntityInput; playedAt: string; msPlayed?: number }
  | { type: "now_playing"; entity: EntityInput | null };

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type StepResult = {
  mutations: Mutation[];
  /** Where the next step continues; null when this pass over the resource is finished. */
  next: Json | null;
  /** Saved when the pass finishes, and given to the next pass (e.g. the newest timestamp seen). */
  checkpoint?: Json;
};

export type HttpReply<T> = { status: number; data: T | null; headers: Headers };
export type StepContext = {
  env: Record<string, string | undefined>;
  credentials: Credentials;
  profile: Profile;
  /** An authorized JSON request with timeouts, retries and rate-limit handling. */
  get<T>(url: string, init?: RequestInit, options?: { allowStatus?: number[] }): Promise<HttpReply<T>>;
  /** Playlists of this connection whose items are out of date. */
  pendingPlaylists(): Promise<{ providerId: string; snapshot: string | null }[]>;
  now(): number;
};

export type SyncResource = {
  /** Stable name, stored in sync_state: "library.tracks", "recent"… */
  key: string;
  capability: Capability;
  label: string;
  /**
   * snapshot: each pass reads the whole list, and what it didn't see has been removed upstream.
   * append: each pass only adds (plays), continuing from the last checkpoint.
   */
  mode: "snapshot" | "append";
  /** For snapshot resources: which library rows a pass replaces. */
  owns?: { relation: Relation; period?: string; kind: EntityKind }[] | "playlists";
  /** How often to look again. Chosen from the provider's rate limits and how much each call returns. */
  intervalMinutes: number;
  /** Scopes this resource needs; it's skipped (and reported) when they weren't granted. */
  scopes?: string[];
  step(ctx: StepContext, state: { cursor: Json | null; checkpoint: Json | null }): Promise<StepResult>;
};

export type Requester = <T>(url: string, init?: RequestInit, options?: { allowStatus?: number[] }) => Promise<HttpReply<T>>;
export type AdapterContext = { env: Record<string, string | undefined>; request: Requester };

/**
 * A music service. Only what a provider really offers is implemented: an adapter without OAuth has
 * no authorize(), one without history has no "recent" resource, and so on.
 *
 * The usual names map onto this interface as: authorize / handleCallback / refreshCredentials /
 * disconnect as below; get_profile is part of what handleCallback and connectWithToken return;
 * get_capabilities is capabilities(); sync_library, sync_playlists, sync_recent_activity and
 * sync_favorites are the entries of `resources`, each tagged with its capability.
 */
export interface ProviderAdapter {
  id: ProviderId;
  name: string;
  auth: AuthKind;
  /** The least access that covers the resources below. */
  scopes: string[];
  /** Environment variables the server needs before anyone can connect. */
  requiredEnv: string[];
  /** For adapters that can never be connected here: why. */
  blocked?: { availability: Exclude<Availability, "available" | "not_configured">; note: string };
  setupNote: string;
  importFormats: string[];
  tokenHelp?: { label: string; url: string };
  /** `granted` null: what the provider supports. Otherwise: what this connection may use. */
  capabilities(granted: string[] | null): Capabilities;
  authorize?(input: { env: Record<string, string | undefined>; redirectUri: string; state: string; codeChallenge: string }): string;
  handleCallback?(ctx: AdapterContext, input: { redirectUri: string; params: URLSearchParams; codeVerifier: string }): Promise<Connected>;
  connectWithToken?(ctx: AdapterContext, input: Record<string, unknown>): Promise<Connected>;
  refreshCredentials?(ctx: AdapterContext, credentials: Credentials): Promise<Credentials>;
  authHeaders(credentials: Credentials, env: Record<string, string | undefined>): Record<string, string>;
  resources: SyncResource[];
  /** Revokes our access on the provider's side, where the provider has a way to. */
  disconnect?(ctx: AdapterContext, credentials: Credentials): Promise<void>;
}

// ---- What the API returns ----

export type ConnectionStatus = "connected" | "syncing" | "partial_access" | "reauth_required" | "error";
export type ResourceStatus = { key: string; label: string; capability: Capability; items: number; lastSuccessAt: string | null; nextDueAt: string | null; error: string | null; skipped?: string };
export type JobView = { id: string; kind: "initial" | "scheduled" | "manual"; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; progress: { resource?: string; label?: string; stored?: number; done?: number; total?: number }; error: string | null; createdAt: string; finishedAt: string | null; runAfter: string | null };
export type ConnectionView = {
  id: string;
  provider: ProviderId;
  status: ConnectionStatus;
  displayName: string;
  profileUrl: string | null;
  scopes: string[];
  capabilities: Capabilities;
  connectedAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  resources: ResourceStatus[];
  job: JobView | null;
};

export type LibraryEntity = { id: string; kind: EntityKind; title: string; artists: string[]; album: string | null; durationMs: number | null; url: string | null; imageUrl: string | null; isrc: string | null; mbid: string | null };
export type SourceRef = { provider: string; label: string; via: "sync" | "import"; use: DataUse };
export type LibraryItem = { entity: LibraryEntity; relation: Relation; period: string; addedAt: string | null; position: number | null; source: SourceRef; /** Other sources holding the same recording (matched by ISRC or MusicBrainz id). */ alsoIn: string[] };
export type PlaylistView = { id: string; name: string; description: string | null; url: string | null; imageUrl: string | null; ownerName: string | null; owned: boolean; trackCount: number | null; itemsSynced: boolean; source: SourceRef };
export type PlaylistTrack = { position: number; addedAt: string | null; entity: LibraryEntity };
export type PlayView = { playedAt: string; msPlayed: number | null; entity: LibraryEntity; source: SourceRef };
export type NowPlayingView = { entity: LibraryEntity; checkedAt: string; source: SourceRef };
export type SourceCoverage = { source: SourceRef; tracks: number; albums: number; artists: number; playlists: number; plays: number; oldestPlay: string | null; newestPlay: string | null; lastSuccessAt: string | null };
export type ImportView = { id: string; format: string; formatLabel: string; filename: string; status: "staging" | "committed"; stats: ImportStats; createdAt: string; committedAt: string | null; use: DataUse };
export type ImportStats = { received?: number; plays?: number; library?: number; playlists?: number; duplicates?: number; rejected?: number; oldest?: string | null; newest?: string | null };
export type LiveEvent = { seq: number; type: "sync" | "connection" | "library" | "import"; payload: Record<string, Json> };
