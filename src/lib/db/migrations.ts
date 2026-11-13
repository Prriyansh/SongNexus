// Schema migrations, applied in order by migrate() in ./index.ts and recorded in schema_migrations.
// Never edit a migration that has shipped: add a new one. They're TypeScript rather than .sql files
// so they're bundled with the server and need no file access at runtime.

export type Migration = { id: string; statements: string[] };

const OWNER = "CHECK ((connection_id IS NULL) <> (import_id IS NULL))";

export const MIGRATIONS: Migration[] = [
  {
    id: "001_accounts",
    statements: [
      `CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username text NOT NULL,
        username_key text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      )`,
      `CREATE INDEX sessions_user ON sessions(user_id)`,
      `CREATE TABLE rate_limits (
        key text PRIMARY KEY,
        count integer NOT NULL,
        reset_at timestamptz NOT NULL
      )`,
      // What the user has agreed to beyond plain storage, e.g. 'combine_sources'.
      `CREATE TABLE user_consents (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind text NOT NULL,
        granted_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, kind)
      )`,
    ],
  },
  {
    id: "002_integrations",
    statements: [
      // One connection per provider per user. `credentials` is an AES-256-GCM envelope, never plaintext.
      `CREATE TABLE connections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider text NOT NULL,
        provider_user_id text NOT NULL,
        display_name text NOT NULL DEFAULT '',
        profile_url text,
        status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'reauth_required', 'error')),
        scopes jsonb NOT NULL DEFAULT '[]',
        credentials text NOT NULL,
        access_expires_at timestamptz,
        connected_at timestamptz NOT NULL DEFAULT now(),
        last_sync_at timestamptz,
        last_success_at timestamptz,
        last_error text,
        UNIQUE (user_id, provider)
      )`,
      // Pending authorizations. The state is stored hashed, used once, and expires in minutes.
      `CREATE TABLE oauth_states (
        state_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider text NOT NULL,
        secret text,
        redirect_uri text NOT NULL,
        expires_at timestamptz NOT NULL
      )`,
      // Per resource ("library.tracks", "recent"…): where a running pass is (page_cursor), where the
      // last finished pass ended (checkpoint), and when the next one is due.
      `CREATE TABLE sync_state (
        connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        resource text NOT NULL,
        page_cursor jsonb,
        checkpoint jsonb,
        generation integer NOT NULL DEFAULT 0,
        items integer NOT NULL DEFAULT 0,
        next_due_at timestamptz NOT NULL DEFAULT now(),
        last_success_at timestamptz,
        last_error text,
        PRIMARY KEY (connection_id, resource)
      )`,
      `CREATE TABLE sync_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('initial', 'scheduled', 'manual')),
        status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        run_after timestamptz NOT NULL DEFAULT now(),
        attempts integer NOT NULL DEFAULT 0,
        lease_until timestamptz,
        progress jsonb NOT NULL DEFAULT '{}',
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        finished_at timestamptz
      )`,
      // The database, not the application, guarantees a connection has at most one job in flight.
      `CREATE UNIQUE INDEX sync_jobs_one_active ON sync_jobs(connection_id) WHERE status IN ('queued', 'running')`,
      `CREATE INDEX sync_jobs_due ON sync_jobs(run_after) WHERE status = 'queued'`,
      `CREATE INDEX sync_jobs_user ON sync_jobs(user_id, created_at DESC)`,
      // An uploaded export. Its rows are staged under the import and only shown once it's committed.
      `CREATE TABLE imports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        format text NOT NULL,
        filename text NOT NULL,
        sha256 text NOT NULL,
        status text NOT NULL DEFAULT 'staging' CHECK (status IN ('staging', 'committed')),
        stats jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        committed_at timestamptz
      )`,
      `CREATE UNIQUE INDEX imports_once ON imports(user_id, sha256) WHERE status = 'committed'`,
      // A recording or artist identified independently of any service: by MusicBrainz id or ISRC only.
      `CREATE TABLE canonical_entities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind text NOT NULL CHECK (kind IN ('track', 'album', 'artist')),
        mbid text,
        isrc text,
        title text NOT NULL,
        artist text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (mbid IS NOT NULL OR isrc IS NOT NULL)
      )`,
      `CREATE UNIQUE INDEX canonical_mbid ON canonical_entities(kind, mbid) WHERE mbid IS NOT NULL`,
      `CREATE UNIQUE INDEX canonical_isrc ON canonical_entities(kind, isrc) WHERE isrc IS NOT NULL`,
      // A track, album or artist exactly as one source describes it, under that source's own id.
      `CREATE TABLE provider_entities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('track', 'album', 'artist')),
        provider_id text NOT NULL,
        title text NOT NULL,
        artists jsonb NOT NULL DEFAULT '[]',
        album text,
        duration_ms integer,
        isrc text,
        mbid text,
        url text,
        image_url text,
        canonical_id uuid REFERENCES canonical_entities(id) ON DELETE SET NULL,
        match_method text CHECK (match_method IN ('mbid', 'isrc')),
        fetched_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider, kind, provider_id)
      )`,
      `CREATE INDEX provider_entities_canonical ON provider_entities(canonical_id) WHERE canonical_id IS NOT NULL`,
      `CREATE INDEX provider_entities_stale ON provider_entities(provider, fetched_at)`,
      `CREATE TABLE library_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        connection_id uuid REFERENCES connections(id) ON DELETE CASCADE,
        import_id uuid REFERENCES imports(id) ON DELETE CASCADE,
        entity_id uuid NOT NULL REFERENCES provider_entities(id) ON DELETE CASCADE,
        relation text NOT NULL CHECK (relation IN ('saved', 'favorite', 'followed', 'top', 'recent')),
        period text NOT NULL DEFAULT '',
        position integer,
        added_at timestamptz,
        generation integer NOT NULL DEFAULT 0,
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        ${OWNER}
      )`,
      `CREATE UNIQUE INDEX library_items_connection ON library_items(connection_id, relation, period, entity_id) WHERE connection_id IS NOT NULL`,
      `CREATE UNIQUE INDEX library_items_import ON library_items(import_id, relation, period, entity_id) WHERE import_id IS NOT NULL`,
      `CREATE INDEX library_items_user ON library_items(user_id, relation)`,
      `CREATE TABLE playlists (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        connection_id uuid REFERENCES connections(id) ON DELETE CASCADE,
        import_id uuid REFERENCES imports(id) ON DELETE CASCADE,
        provider_playlist_id text NOT NULL,
        name text NOT NULL,
        description text,
        url text,
        image_url text,
        owner_name text,
        owned boolean NOT NULL DEFAULT true,
        track_count integer,
        snapshot text,
        synced_snapshot text,
        generation integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        ${OWNER}
      )`,
      `CREATE UNIQUE INDEX playlists_connection ON playlists(connection_id, provider_playlist_id) WHERE connection_id IS NOT NULL`,
      `CREATE UNIQUE INDEX playlists_import ON playlists(import_id, provider_playlist_id) WHERE import_id IS NOT NULL`,
      `CREATE INDEX playlists_user ON playlists(user_id)`,
      `CREATE TABLE playlist_items (
        playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        position integer NOT NULL,
        entity_id uuid NOT NULL REFERENCES provider_entities(id) ON DELETE CASCADE,
        added_at timestamptz,
        PRIMARY KEY (playlist_id, position)
      )`,
      // One play. The same track at the same instant from the same source is a duplicate; the same
      // track at another time is another play and is kept.
      `CREATE TABLE listening_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        connection_id uuid REFERENCES connections(id) ON DELETE CASCADE,
        import_id uuid REFERENCES imports(id) ON DELETE CASCADE,
        entity_id uuid NOT NULL REFERENCES provider_entities(id) ON DELETE CASCADE,
        played_at timestamptz NOT NULL,
        ms_played integer,
        ${OWNER}
      )`,
      `CREATE UNIQUE INDEX listening_events_connection ON listening_events(connection_id, entity_id, played_at) WHERE connection_id IS NOT NULL`,
      `CREATE UNIQUE INDEX listening_events_import ON listening_events(import_id, entity_id, played_at) WHERE import_id IS NOT NULL`,
      `CREATE INDEX listening_events_user ON listening_events(user_id, played_at DESC)`,
      `CREATE TABLE now_playing (
        connection_id uuid PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity_id uuid REFERENCES provider_entities(id) ON DELETE CASCADE,
        checked_at timestamptz NOT NULL DEFAULT now()
      )`,
      // What the live stream (/api/integrations/events) tails, so progress reaches a browser even when
      // another server instance is doing the work. Pruned after a day.
      `CREATE TABLE user_events (
        seq integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX user_events_user ON user_events(user_id, seq)`,
    ],
  },
  {
    id: "003_import_batches",
    statements: [
      `CREATE TABLE import_batches (
        import_id uuid NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
        batch_key text NOT NULL,
        fingerprint text NOT NULL,
        PRIMARY KEY (import_id, batch_key)
      )`,
    ],
  },
  {
    id: "004_job_leases",
    statements: ["ALTER TABLE sync_jobs ADD COLUMN lease_token uuid NOT NULL DEFAULT gen_random_uuid()"],
  },
];
