# Music account integrations

See [current implementation and verification status](readiness.md) for completed checks and external testing requirements.

The account implementation extends the existing Next.js app. Postgres holds independent Song Nexus users, hashed sessions, encrypted connection credentials, OAuth states, sync cursors, leased jobs, provider references, canonical identifiers, library membership, playlists, listening events, import provenance and progress events. Adapters never write SQL; each page and its cursor are persisted together. No Redis dependency is needed for this queue.

The initial audit found a client-rendered React app, Next.js API routes, optional Redis for Friends room codes, and a separate Flask comparison service. There was no existing user database or account authentication to replace. Implementation order: account/database foundation, adapters and durable worker, API lifecycle, dashboard/import/library UI, then security and recovery tests. Existing discovery features remain available anonymously.

## Local setup

1. Use Node 22 and run `npm ci`.
2. Copy `.env.example` to `.env.local`. Set `APP_URL` to the exact origin you open in the browser. Use `http://127.0.0.1:3000` when testing Spotify, which rejects `localhost` redirect URIs.
3. Run `npm run dev`, open `/accounts`, and create a Song Nexus account. No provider credentials are needed for account creation or file imports. ListenBrainz requires only your own user token.
4. Enable other providers as described in [providers.md](providers.md). Missing credentials produce Setup Required cards with no Connect button.

Development uses persistent embedded Postgres (PGlite) under `.data/pglite`; `.data/dev-encryption.key` preserves the development credential key across restarts. Keep both private. Production refuses to create accounts without `DATABASE_URL` and refuses connections without a base64 32-byte `INTEGRATIONS_ENCRYPTION_KEY`. Migrations in `src/lib/db/migrations.ts` apply automatically under a transactional lock.

Generate a production encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Store it in the deployment's secret manager. Back it up separately from the database: losing it makes provider credentials unreadable. For rotation, put the old key in `INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS`; refreshed credentials are sealed with the new key. Non-refreshing credentials need reconnecting before removing the previous key.

## Deployment and scheduling

Long-lived `next start`, Docker and development processes start a worker every minute. Individual resources have longer provider-specific intervals. Jobs persist in Postgres, with a unique active job per connection, row locks for claiming and token refresh, leases, retry deadlines, backoff, and resumable cursors. Expired leases resume after restarts. Manual sync never overrides an existing retry deadline.

Vercel skips the process timer. `vercel.json` supplies a daily cron compatible with Hobby schedules; provision Postgres, encryption, `APP_URL` and `CRON_SECRET` in Vercel. More frequent unattended updates require a suitable schedule/plan or an external scheduler sending `Authorization: Bearer <CRON_SECRET>` to `GET /api/integrations/cron`. Do not put that secret in a URL. Set `SYNC_WORKER=off` only when replacing the process worker with an external scheduler. User requests also schedule bounded work through Next.js `after()`; `/api/integrations/events` delivers user-scoped SSE updates while the dashboard is open. UI updates are immediate after storage, not real-time provider push.

For Docker, configure `.env.local` with production credentials, set `POSTGRES_PASSWORD` in your shell (use a URL-safe value), then run `docker compose up --build`. Postgres data uses a named volume and port 5432 is not exposed. The image runs as the Node user. Serve production over HTTPS through your proxy and set `APP_URL` accordingly; production cookies are Secure, HttpOnly and host-bound. Docker builds download the existing Google font. Docker execution needs an installed Docker engine and has not been validated in this environment.

## Data and user controls

`/accounts` provides sign-in/registration, connect/reconnect, capability limitations, last successful sync, per-resource errors, queued/running progress, Sync Now, disconnect, source-filtered music and playlist contents, history, consent settings, export preview, duplicate reporting and deletion. Disconnect deletes credentials and all connection-owned rows; account deletion requires the password. Local deletion still completes if provider revocation is unavailable. Users can also revoke on provider settings pages.

Exports are parsed locally with a 25 MB browser limit. Only normalized rows are sent, in batches of 1,000 (server limit 2,500); imports permit up to 500,000 rows. ZIP archives must be extracted first. Rows stay invisible until commit. A transactional batch ledger makes retries idempotent, including playlist rows, without removing repeated tracks in distinct batches. File fingerprints detect exact repeated imports. Timestamped repeated plays are preserved, identical plays deduplicate, invalid rows are counted, and deleting an import removes only its owned rows. Generic imports require the user's declaration that they are not bypassing service restrictions.

Metadata identity is kept by source ID. Canonical links use exact MusicBrainz IDs or ISRCs for open sources; names alone never create cross-source matches, and conflicting MBIDs stay distinct. Missing source IDs in exports necessarily use metadata fingerprints; such records are not evidence of an exact catalog match. Provider restrictions also apply to imports. See [compliance.md](compliance.md).

## API inventory

| Endpoints | Purpose |
| --- | --- |
| `POST /api/auth/register`, `/login`, `/logout` | Independent Song Nexus sessions |
| `GET, DELETE /api/auth/me` | Session status; password-confirmed account deletion |
| `PUT /api/auth/consents` | Set `combine_sources` consent |
| `GET /api/integrations/providers` | Availability, capabilities, formats, policy, scheduling |
| `POST /api/integrations/:provider/connect` | OAuth URL, ListenBrainz token, or MusicKit user token |
| `GET /api/integrations/:provider/callback` | Single-use state-bound callback |
| `GET /api/integrations/apple-music/token` | Signed-in browser developer token |
| `GET /api/integrations/connections`, `GET, DELETE /:id` | User-owned status and deletion |
| `POST /api/integrations/connections/:id/sync` | Idempotent manual job request |
| `GET /api/integrations/events`, `/cron` | User SSE; secret-protected worker pass |
| `GET /api/library?source=…` | Library/favorites/top/recent lists with kind, relation, query and page filters |
| `GET /api/library/playlists`, `/playlists/:id` | Source-filtered playlists and paged contents |
| `GET /api/library/activity`, `/overview`, `/discovery` | Timestamped plays, coverage, consent-gated open-source discovery |
| `GET, POST /api/imports` | Import list and staged job creation |
| `POST /api/imports/:id/rows`, `/commit`; `DELETE /api/imports/:id` | Validated batches, publish, rollback/deletion |

Writes require `x-requested-with: SongNexus` plus same-origin checks; sessions use HttpOnly cookies. Responses are not cached. Every private read/write is owner-filtered. Never expose provider credentials in browser storage, URLs or application logs.

## Verification and live smoke test

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Tests use in-memory Postgres and mocked third-party responses. Provider contract fixtures validate the app's interpretation of documented schemas; they do not establish live provider success.

With the local development server running, `node scripts/smoke-local.mjs http://127.0.0.1:3000` checks real HTTP routing, registration/session cookies, private API gates, import staging/retries/commit/deletion, consent and discovery. It creates a temporary account, deletes it in cleanup and never connects a provider. It accepts local origins only.

To smoke-test a configured provider:

1. Register/sign in at `/accounts`, approve the service's own consent page, and verify the callback returns to the dashboard with the expected identity. For Apple use MusicKit's authorization window; for ListenBrainz paste your user token.
2. Wait for the initial job, inspect resource status, and compare a few songs, playlist positions, source links and timestamps against the service. A smaller or missing history is a provider limit, not evidence of complete history.
3. Add/remove a supported library item or edit a playlist upstream, request Sync Now after any retry delay, and verify changes. Repeat Sync Now to check no duplicate active jobs or plays.
4. Open a second Song Nexus account and verify it cannot see the first account's connections/imports. Test malformed exports, canceled previews, exact-file duplicates, deletion and disconnect.
5. Restart the app during a multipage sync; allow the 120-second lease to expire and verify the cursor resumes. Revoke access upstream and verify reconnect status after the next authorized check. Never publish tokens/screenshots containing secrets.

No adapters have been live-tested here. Provider credentials, developer approvals, production Postgres/TLS setup and real-provider smoke testing remain external setup. Password recovery, native Shazam, playback/scrobble submission and unrestricted cross-service analytics are not implemented. The existing web app has no eligible first-party music playback event source, so no scrobbles are fabricated from library imports, graph views, previews or third-party playback.
