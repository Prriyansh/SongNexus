# Changelog

## 0.2.0-alpha.1 (2026-11-23)

The first alpha of SongNexus as one app: the Python API (`server/`), the web app (`web/`) and the
sound & lyrics service (`song_compare/`), deployed together on Vercel.

### New

- **One app.** The earlier Next.js app was merged into this one, which took over its features;
  its code stays in the git history.
- **Sound and lyrics in song comparisons** (Ishita's `song_compare`): how alike two songs are and
  why, their sound profiles, tempo and key, lyric mood, themes and structure, and songs that
  sound alike. Songs outside its 2022 dataset are named rather than estimated.
- **Artist introductions and honors**: the Wikipedia introduction (CC BY-SA 4.0, always linked),
  and the awards and nominations Wikidata lists. Artist comparisons show awards both received.
- **More credits** in artist comparisons: people Discogs (and Genius, with a key) credit on both
  artists' work, with the releases or songs as evidence and what each source checked.
- **Personalize**: pick genres and artists you love; Home's new **For you** shelf starts from
  them, each card saying why it is there.
- **Vercel deployment**: one project, three services; the catalog is built at deploy time. With
  no settings it serves signed out.

### Known limits of this alpha

- **No accounts by default.** Sign-in needs a Firebase project, and accounts that persist need
  a PostgreSQL database (see "Deploy on Vercel" in the README). Without them, everything else
  works signed out, and personalization is kept in the browser.
- **The catalog is a curated sample** (about 5,900 artists); photos and Wikipedia introductions
  cover the best-known 1,500 at deploy time.
- **More credits is slow the first time** for a pair of artists (about half a minute without a
  Discogs token) and partial when a source runs out of time; it says so.
- **Sound and lyrics** covers the 2022 dataset only; newer songs show as not in the library.
