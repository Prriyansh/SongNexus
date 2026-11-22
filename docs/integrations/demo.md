# Demo: Connected Music Accounts

A walkthrough of about 8 minutes that needs no provider credentials. It runs on your own machine
against the development database, using `scripts/demo-seed.mjs` to prepare an account with sample
data. The listening in that data is made up for the demo (the songs are real); every file it
loads is named "DEMO sample".

## Before the demo (2 minutes)

| Step | Command | You should see |
| --- | --- | --- |
| 1. Start the app | `.\demo.cmd` (Windows), or `npm run dev -- --hostname 127.0.0.1` | `Ready`, serving `http://127.0.0.1:3000` |
| 2. Seed the demo account, in a second terminal | `node scripts/demo-seed.mjs` | `Demo account created.` and four `imported:` lines |
| 3. Open the page | `http://127.0.0.1:3000/accounts` | The sign-in form |

Sign-in for the demo account: username `demo`, password `songnexus-demo`.

On Windows without Node on your PATH, use the bundled one for step 2:
`.\.tools\node\node.exe scripts\demo-seed.mjs`. Running the seed twice is safe; it skips what is
already there. Keep `scripts/demo-sample-history.csv` handy for part 4.

## The walkthrough

### 1. An account that belongs to Song Nexus (1 min)

| Do | Say |
| --- | --- |
| Show the sign-in form, then sign in as `demo`. | "A Song Nexus account is independent of every music service. Passwords are hashed, the session is an HttpOnly cookie, and each user only ever sees their own connections." |
| Point at "Signed in as demo", **Sign out** and **Delete account**. | "Deleting the account removes everything stored for it, in one step." |

### 2. Ten services, described honestly (2 min)

| Do | Say |
| --- | --- |
| Scroll the provider cards. Point at the badges. | "Every card states what is possible on this server. **Setup Required** means the adapter is built but this server has no developer credentials for it, so there is no Connect button to press." |
| Open **Permissions and limitations** on Spotify. | "Spotify shares only the last 50 plays, and its policy forbids mixing its data with other services or deriving statistics from it. The card says so before you connect." |
| Open the same on YouTube Music. | "Google's sign-in gives YouTube playlists and liked music videos, not YouTube Music history. We say that instead of implying full access." |
| Show Shazam (**Import Only**), Deezer (**Unsupported**) and Amazon Music (**Partner Access Required**). | "Where there is no way in, there is no sign-in button, only an explanation and the import that does work." |
| Show ListenBrainz (**Ready to connect**). Press **Connect**, show the token field, then **Cancel**. | "ListenBrainz works on any server because you link it with your own token. It is checked with ListenBrainz and stored encrypted." |

Optional, if you have a ListenBrainz account: paste your real user token and press **Link
account**. The card goes to **Syncing**, then **Connected**, and your listens appear under
**Your music library**. This is the one live connection possible without operator setup. It was
not exercised while this demo was prepared, so try it once beforehand.

### 3. The library, one source at a time (2 min)

Scroll to **Your music library**.

| Do | Say |
| --- | --- |
| **Source**: "ListenBrainz listens · DEMO sample listens.jsonl". **Show**: "Listening history". | "Sixty plays over two weeks, each with its time. The line above says it is an imported snapshot and which dates it covers, so nobody mistakes it for a complete history." |
| Press **Older plays**. | "History pages backwards by time." |
| **Source**: "Shazam history…". **Show**: "Library, favorites and provider rankings". | "A Shazam is a recognition, not a play, so these are saved songs with the time each was identified." |
| **Source**: "Playlist or history file…". **Show**: "Playlists". Open **Road trip (demo)**. | "Playlists keep their order." |
| **Source**: "Spotify listening history…". **Show**: "Listening history". | "A Spotify export is shown, but only here, in its own view." |

### 4. Importing a file, with preview and rollback (2 min)

Scroll to **Import your music export**.

| Do | Say |
| --- | --- |
| Choose `scripts/demo-sample-history.csv`. | "The file is read in the browser. Nothing is stored yet; this is a preview." |
| Point at the preview: 8 plays, 1 duplicate in file, and the two skipped lines. | "It found eight plays. Two rows have no title or no readable date and are left out, and it tells you. One song appears twice at the same minute, which is one play listed twice, so it is stored once; the same song on other days stays." |
| Tick the authorization box, press **Confirm import**. | "Now it is committed, and it appears as a source in the library." |
| Choose the same file again. | "The same file is refused: it is recognised by its fingerprint." |
| Under **Imported files**, press **Delete imported data** on the file you just imported, then **Confirm deletion**. | "Deleting an import removes exactly what it added and nothing else." |

### 5. Consent, and what stays separate (1 min)

Scroll to **Data permissions**.

| Do | Say |
| --- | --- |
| Tick **Combine my open sources for discovery**. | "Combining sources is opt-in. Only open sources take part: ListenBrainz, Last.fm and permitted imports." |
| Back in the library, open **Source**: "Combined open sources". | "The Spotify sample is not in this list, and cannot be. That rule lives in one policy table on the server, not in the page." |
| Press **Copy open-source songs to my browser playlist and explore**. | "With consent, the open-source songs become a playlist on the Connection Web, the app's existing discovery map. Spotify and YouTube data never reach it." |

### Closing line

"What you saw runs without a single provider key. Each adapter is written against the provider's
published API and covered by tests with mocked responses, but none has been run against the live
service yet; that needs each provider's developer credentials, and
[readiness.md](readiness.md) lists exactly what is outstanding."

## Questions you may get

| Question | Answer |
| --- | --- |
| Is it real time? | The page updates the moment Song Nexus stores something (a live event stream). How soon Song Nexus hears from a provider depends on that provider: plays are checked every 10 to 15 minutes, libraries every 6 hours, and **Sync Now** checks straight away. |
| Why can't I press Connect on Spotify? | This server has no Spotify developer app configured. See [providers.md](providers.md) for the setup, and [connecting.md](connecting.md) for what a user then does. |
| Where are tokens kept? | In the database, encrypted with AES-256-GCM under a server-held key. They never reach the browser or the logs. |
| What happens when I disconnect? | The credentials and everything synced through that connection are deleted, and access is revoked at the provider where it offers a way. |

## After the demo

`node scripts/demo-seed.mjs --reset` deletes the demo account and everything it holds. The
"Connected open sources" playlist from part 5 lives in your browser only; clear it from the
Connection Web's playlist option, or leave it.
