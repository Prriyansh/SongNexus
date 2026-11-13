# Provider setup and feasibility

Reviewed against official documentation on November 13, 2026. None of these adapters has been live-tested with real credentials in this checkout. Capability descriptions come from the adapter registry and reflect granted scopes per connection. Credential presence enables a connection flow; it does not guarantee the provider has approved the application.

For each OAuth provider register exactly `<APP_URL>/api/integrations/<provider>/callback`. The browser and `APP_URL` must use the same origin. Set a public HTTPS origin for production. Local examples below use `http://127.0.0.1:3000`.

| Provider | Application-side functionality | Credentials and external requirements | Default check intervals |
| --- | --- | --- | --- |
| Spotify | PKCE, profile, saved songs/albums, owned/collaborative playlist contents, following, provider top lists, last 50 plays, current track | `SPOTIFY_CLIENT_ID`; Premium app owner, authorized test users, development cap; extended access for scale | History/current track 15 min; library/playlists 6 h; following 12 h; top lists daily |
| YouTube | Google PKCE, channel identity, authorized playlists/items | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; YouTube Data API enabled; OAuth test users or verified consent screen | Playlists 6 h |
| Apple Music | MusicKit JS, signed developer JWT, storefront, library songs/albums/artists, playlists, recent tracks and heavy rotation | `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY`; Apple Developer membership and MusicKit key; user subscription for library | Library/playlists 6 h; recent 1 h; heavy rotation daily |
| Last.fm | Signed web-auth session, scrobbles with timestamps, current track, loved tracks, provider charts | `LASTFM_API_KEY`, `LASTFM_SHARED_SECRET`; register API account; commercial use requires agreement | Scrobbles 10 min; loved 6 h; charts daily |
| ListenBrainz | Validated user token, recent/incremental listens, current track, loved recordings and JSPF playlists | User token from ListenBrainz settings; no app credentials | Recent listens 10 min; loved/playlists 6 h |
| SoundCloud | PKCE, profile, likes, following, playlists, recent ordered tracks | `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`; developer app registration/Artist Pro eligibility | Likes/playlists 6 h; following 12 h; recent 1 h |
| TIDAL | PKCE, identity/country, collection tracks/albums/artists and owned playlists | `TIDAL_CLIENT_ID`; optional `TIDAL_CLIENT_SECRET` if issued; developer app with required scopes/access tier | Collection/playlists 6 h |
| Shazam | CSV import only | Web app has no native SHLibrary client | Snapshot only |
| Deezer | Disabled account connection; generic playlist import | No approved app credentials/access in this repository; new registration availability must be confirmed with Deezer | Snapshot only |
| Amazon Music | Disabled, Partner Access Required | Closed-beta partner approval; no approved app in this repository | Snapshot only |

## OAuth scopes and callback URLs

| Provider | Callback (append to `APP_URL`) | Requested scopes |
| --- | --- | --- |
| Spotify | `/api/integrations/spotify/callback` | `user-library-read playlist-read-private playlist-read-collaborative user-follow-read user-top-read user-read-recently-played user-read-currently-playing` |
| Google/YouTube | `/api/integrations/youtube/callback` | `https://www.googleapis.com/auth/youtube.readonly` (offline access, consent prompt) |
| Last.fm | `/api/integrations/lastfm/callback` | Signed Last.fm web authentication, not OAuth scopes; state is carried in the `cb` URL |
| SoundCloud | `/api/integrations/soundcloud/callback` | Authorization Code with PKCE; no scope string required by this adapter |
| TIDAL | `/api/integrations/tidal/callback` | `user.read collection.read playlists.read` |

Apple and ListenBrainz have no OAuth callback. Apple authorization loads MusicKit v3 from Apple's CDN, obtains a user token after user approval, and validates it against `/v1/me/storefront` before saving encrypted. Apple has no refresh-token flow here; expired/revoked authorization requires reconnecting. Developer JWTs expire after 12 hours. Restrict the registered app's website/domain configuration to your intended deployment.

Spotify reads `/playlists/:id/items` and the renamed item field, with compatibility for older response fields. Its development restrictions can make individual resources unavailable; errors appear as Partial Access instead of invented data. Existing app exceptions and delayed endpoint changes mean access must be checked against the registered app's actual tier. Google OAuth grants YouTube account access, not complete YouTube Music library/history access. Takeout imports provide supported fallback files.

ListenBrainz explicitly directs full-history users to its export API; this adapter reads a bounded recent window of at most 1,000 listens, then overlapping incremental updates. Large gaps can require an export. Last.fm contains only submitted scrobbles. Apple and SoundCloud recent lists have no play timestamps, so they are stored as ordered library lists, never fabricated listening events. Neither a provider's current-track response nor a Shazam recognition proves a completed play.

## Primary references

- [Spotify February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes), [redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
- [YouTube authorization](https://developers.google.com/youtube/data/guides/authentication), [playlist access](https://developers.google.com/youtube/data/guides/implementation/playlists)
- [Apple user authentication](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit), [MusicKit](https://developer.apple.com/documentation/musickit)
- [Last.fm web authentication](https://www.last.fm/api/webauth), [recent tracks](https://www.last.fm/api/show/user.getRecentTracks)
- [ListenBrainz core API and full-history guidance](https://listenbrainz.readthedocs.io/en/latest/users/api/core.html)
- [SoundCloud official guide](https://developers.soundcloud.com/docs/api/guide), [OpenAPI](https://developers.soundcloud.com/docs/api/explorer/api.json)
- [TIDAL official OpenAPI](https://tidal-music.github.io/tidal-api-reference/tidal-api-oas.json)
- [ShazamKit SHLibrary](https://developer.apple.com/documentation/shazamkit/shlibrary)
- [Amazon Music closed beta](https://developer.amazon.com/docs/music/landing_home)
- [Deezer developer portal](https://developers.deezer.com/myapps) (not accessible during automated verification; new registration remains unverified here)
