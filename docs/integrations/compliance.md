# Account data policy

The server enforces source separation before returning data. These are conservative application restrictions, not a blanket legal approval for a deployment. Review the linked provider terms for the registered app and intended commercial use. Uncertain uses stay disabled.

| Data source | Show user's own data with attribution | Combine/match with other services | Discovery/graphs | AI ingestion | Retention |
| --- | --- | --- | --- | --- | --- |
| Spotify, including known Spotify exports | Separate source view | Blocked | Blocked | Blocked | Delete connection-owned data on disconnect; imports have independent deletion |
| YouTube, including known Takeout exports | Separate source view | Blocked | Blocked | Blocked | API-derived data refreshed/deleted within 30 days; disconnect deletes connection data |
| Apple Music, SoundCloud, TIDAL and their identified exports | Separate source view | Disabled pending additional terms review | Disabled | Disabled | Disconnect/import deletion |
| Last.fm | With attribution; commercial agreement may be needed | Explicit combine-source consent | Explicit consent | App sends no account data to models | Disconnect deletes connection data |
| ListenBrainz | With source labels | Explicit consent | Explicit consent | App sends no account data to models | Disconnect/import deletion |
| Shazam export or generic user-controlled file | Labeled snapshot | Explicit consent; user must not bypass provider restrictions | Explicit consent | App sends no account data to models | Import deletion |
| Deezer/Amazon account APIs | Not enabled | Not enabled | Not enabled | Not enabled | No account API data collected |

Spotify content never enters the Connection Web, Friends maps, taste/search rankings, listening statistics, games or model requests. YouTube content is isolated from cross-service aggregation and derived analytics. Imports retain the recognized provider's policy class; the generic parser is not offered as an alternative way to evade those restrictions. The UI requires a declaration before uploading. A deployment should review legal support for any additional generic export formats before enabling them.

Open sources require `combine_sources` for the combined library and `/api/library/discovery`. Canonical entities contain only identifier-based matches from open sources. Two names alone never establish a canonical recording. A MusicBrainz recording conflict overrides an ISRC match. No library account data is forwarded to the app's existing AI or sound-analysis endpoints.

Security controls include password scrypt hashes, hashed random sessions/OAuth states, HttpOnly SameSite cookies, Secure production cookies, same-origin CSRF checks, PKCE where supported, ten-minute single-use states, AES-256-GCM encrypted provider credentials with per-user/provider associated data, serialized refresh, owner-filtered resources, redacted provider errors, rate limits and durable retry state. Import parsing supports text formats only; archives are not extracted server-side. React escapes displayed file/provider text. SQL values are parameterized and pagination is bounded.

Deleting a connection cascades through its stored credentials, jobs, cursors, music memberships, playlists and plays; unreferenced catalog metadata is cleaned up. Other users' records are preserved. Disconnect attempts provider-side revocation where implemented, but local deletion does not depend on that call succeeding. Imported data is independent and removable by its own import. Account deletion requires the password and removes all user-owned records. Database backups are operator-controlled and need a documented expiry/deletion policy before public deployment.

Do not claim production or contractual approval based on mocked tests. Provider developer approvals, current tiers and scopes, privacy-policy publication, HTTPS, secret management, backup retention and live smoke tests remain deployment responsibilities.

Sources: [Spotify policy](https://developer.spotify.com/policy), [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies), [Apple agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/), [Last.fm terms](https://www.last.fm/api/tos), [ListenBrainz terms](https://listenbrainz.org/terms-of-service/), [SoundCloud terms](https://developers.soundcloud.com/docs/api/terms-of-use), [TIDAL terms](https://developer.tidal.com/documentation/guidelines/guidelines-developer-terms).
