# Changelog

## 0.2.0-alpha.1 (2026-11-23)

The first alpha of SongNexus as one app: the Python API (`server/`), the web app (`web/`) and the
sound & lyrics service (`song_compare/`), deployed together on Vercel.

### New

- **One app.** The earlier Next.js app was merged into this one, which took over its features;
  its code stays in the git history.
- **Sound and lyrics in song comparisons** (Ishita's `song_compare`): how alike two songs are and
  why, their sound profiles, tempo and key, lyric mood, themes and structure, and songs that
  sound alike. Songs outside its 2022 dataset are named rather than estimated. Song pickers offer
  songs with the full analysis (Priyansh's pickers).
- **Similar music** (`/map`, Lakadia's similar-music Connection Web on Helen's map): start from
  an artist, a song, two artists or your playlist; everything is placed by how often listeners
  play it together (ListenBrainz), and every node says why it is there. Zooming in near an
  artist finds more around it.
- **Compare playlists with a friend** (Lakadia's Friends rooms, with Helen's presets and
  autofill): two playlists on one map, joined with a six-character code and kept for a week.
- **Artist introductions and honors**: the Wikipedia introduction (CC BY-SA 4.0, always linked),
  Wikipedia readership, and the awards and nominations Wikidata lists.
- **Charts, covers and concerts**: Billboard Hot 100 history for artists and songs, album covers
  from the Cover Art Archive, and concerts and festivals from MusicBrainz ("shared the bill").
- **Artist comparisons**: awards both received, labels both released on, artists Last.fm lists
  as similar to both (with a key), a two-artist map, and **More credits**: people Discogs (and
  Genius, with a key) credit on both artists' work.
- **Top song** on artist pages (Priyansh's shortcut): Deezer's ranking picks which of the
  artist's songs to open; no Deezer numbers are shown.
- **Personalize**: genres, artists and songs you love, how you like to discover and what to call
  you (Lakadia's first-visit questions); Home's **For you** shelf starts from them, and search
  ranks your saved music first among equally good matches (Helen's ranking).
- **Sign in with Google**, the only way to sign in: the API refuses any other Firebase sign-in
  method.
- **Vercel deployment**: one project, three services; the catalog is built at deploy time and
  loaded into the hosted PostgreSQL database (Neon) when the project has one.

### Known limits of this alpha

- **No accounts by default.** Sign-in needs a Firebase project, and accounts that persist need
  a PostgreSQL database (see "Deploy on Vercel" in the README). Without them, everything else
  works signed out, and personalization is kept in the browser.
- **The catalog is a curated sample**; photos and Wikipedia introductions cover the best-known
  1,500 artists at deploy time.
- **More credits is slow the first time** for a pair of artists (about half a minute without a
  Discogs token) and partial when a source runs out of time; it says so.
- **Sound and lyrics** covers the 2022 dataset only; newer songs show as not in the library.
- **Similar songs** are read live from ListenBrainz; a song without listening data has none.
