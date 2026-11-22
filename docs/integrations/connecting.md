# Connecting your music accounts

How a Song Nexus user links each service. For the server-side setup an operator does first
(developer credentials, callback URLs), see [providers.md](providers.md).

## Before you start

1. Open **Connected Music Accounts** in the sidebar (`/accounts`).
2. Choose **Create an account**, pick a username and a password of at least 10 characters, and
   sign in. This Song Nexus account is separate from every music service; none of them see it.
3. Find the service's card. Its badge tells you what is possible on this server:

| Badge | What it means for you |
| --- | --- |
| Ready to connect | Press **Connect**. |
| Setup Required | The server's operator hasn't added this service's developer credentials. There is no Connect button; use an import in the meantime. |
| Import Only | The service has no web sign-in. Upload its export file. |
| Partner Access Required / Unsupported | The service doesn't give Song Nexus access. Upload a playlist file. |

Each card's **Permissions and limitations** lists exactly what will be read and what the service
doesn't share.

## Service by service

| Service | How you connect | What you'll approve or need | Then |
| --- | --- | --- | --- |
| **Spotify** | **Connect** → sign in on Spotify's page → **Agree**. You're sent back to Song Nexus. | Read access to your saved songs and albums, playlists, followed artists, top items and recent plays. While the operator's Spotify app is in Development Mode, they must first add your Spotify account to it (at most 5 people). | Only your last 50 plays are available, collected from the day you connect. For older history, import your Spotify data export. |
| **YouTube Music** | **Connect** → choose your Google account → allow **View your YouTube account**. | Read-only YouTube access. Until Google has verified the operator's app, they must add you as a test user, and Google shows an "unverified app" notice. | You get your YouTube playlists (including ones made in YouTube Music) and liked videos in YouTube’s Music category. Google shares no listening history or YouTube Music library; import those from Google Takeout. |
| **Apple Music** | **Connect** → Apple's own window opens → sign in with your Apple Account → **Allow**. | An Apple Music subscription, for your library to be readable. Allow pop-ups for the site if the window doesn't open. | Library, playlists, recently played (in order, without times) and heavy rotation. Apple's sign-in lasts about six months; press **Reconnect** when the card asks. |
| **Last.fm** | **Connect** → sign in on Last.fm → **Yes, allow access**. | Nothing else. | Your scrobbles with times, loved tracks and charts. Only music you scrobbled is there. |
| **ListenBrainz** | **Connect** → open **Find your token** (listenbrainz.org → Settings) → copy your **User token** → paste it → **Link account**. | Your token. It is checked with ListenBrainz and stored encrypted. Works on every server; no operator setup. | Recent listens (up to 1,000 on the first sync, then new ones), loved recordings and playlists. For full history, import a ListenBrainz export. |
| **SoundCloud** | **Connect** → sign in on SoundCloud → **Connect and continue**. | Nothing else. | Liked tracks, playlists, accounts you follow and your last 25 played tracks (no times). |
| **TIDAL** | **Connect** → sign in on TIDAL → approve. | Read access to your profile, My Collection and playlists. | Collection tracks, albums, artists and the playlists you created. TIDAL shares no listening history. |
| **Shazam** | No sign-in. Go to shazam.com/myshazam → **Download CSV**, then use **Import your music export**. | The file `shazamlibrary.csv`. | Your Shazams appear as saved songs with the time each was identified. |
| **Deezer** | Can't be connected: Deezer isn't giving Song Nexus developer access. | A playlist exported to CSV or JSON by any tool. | Import the file; it's stored as a snapshot. |
| **Amazon Music** | Can't be connected: Amazon's API is limited to approved partners. | A playlist exported to CSV or JSON by any tool. | Import the file; it's stored as a snapshot. |

After a sign-in you land back on `/accounts` with the card showing **Syncing**, then
**Connected** and a last-synced time. If it shows **Partial Access**, open **Resource sync
status** to see which part the service refused.

## Importing an export instead

Use **Import your music export** on the same page. Unzip the download first and pick one file at
a time (JSON, JSONL or CSV, up to 25 MB). You see a preview before anything is stored, and can
delete an import later, which removes exactly what it added.

| From | Where to get it | File to pick |
| --- | --- | --- |
| Spotify | spotify.com → Account → Privacy → Download your data | `Streaming_History_Audio_*.json` or `StreamingHistory_music_*.json`, `YourLibrary.json`, `Playlist1.json` |
| YouTube Music | takeout.google.com → YouTube and YouTube Music (history in JSON format) | `watch-history.json`, `music library songs.csv` |
| Apple Music | privacy.apple.com → Request a copy of your data → Apple Media Services information | `Apple Music Play Activity.csv`, `Apple Music Library Tracks.json` |
| ListenBrainz | listenbrainz.org → Settings → Export data | the listens `.jsonl` files |
| Shazam | shazam.com/myshazam → Download CSV | `shazamlibrary.csv` |
| Anything else | any export tool | a CSV or JSON with a title and an artist column (add a date column for listening history) |

An import is a snapshot from the day you exported it. It never updates by itself.

## Afterwards

- **Sync Now** on a card checks that service straight away; otherwise it is checked on a schedule.
- **Reconnect** appears when a service stops accepting the authorization (you changed your
  password, revoked access, or it expired). Your stored music stays until you reconnect or disconnect.
- **Disconnect** deletes the stored credentials and everything synced through that connection.
  You can also revoke Song Nexus inside the service's own settings.
- **Delete account**, next to Sign out, removes your Song Nexus account and all of the above.

None of these sign-ins has been tested against the live services from this repository yet, so the
button labels on each service's own pages may differ slightly from the wording here.
