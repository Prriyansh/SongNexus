// Every source Song Nexus reads, with its terms and what it's used for: the "Data sources and
// licenses" list in the footer, and the table in README.md. Add a source here (and there) before
// any code reads from it. "Needs a key" sources only run when their key is configured.

export type DataSource = {
  name: string;
  url: string;
  /** The license or terms as the provider states them. */
  terms: string;
  termsUrl: string;
  /** What the app uses it for, in plain words. */
  feeds: string;
  needsKey?: boolean;
};

export const DATA_SOURCES: readonly DataSource[] = [
  { name: 'MusicBrainz', url: 'https://musicbrainz.org', terms: 'CC0 (core data); genres and tags CC BY-NC-SA 3.0', termsUrl: 'https://musicbrainz.org/doc/About/Data_License', feeds: 'Search, artists, songs, releases, credits, genres and every connection' },
  { name: 'Cover Art Archive', url: 'https://coverartarchive.org', terms: 'Images stay their rights holders’', termsUrl: 'https://musicbrainz.org/doc/Cover_Art_Archive', feeds: 'Album covers' },
  { name: 'Deezer', url: 'https://www.deezer.com', terms: 'Deezer API terms', termsUrl: 'https://developers.deezer.com/termsofuse', feeds: 'Ranking an artist’s top song, related artists and their photos (no Deezer numbers are shown)' },
  { name: 'Wikidata', url: 'https://www.wikidata.org', terms: 'CC0', termsUrl: 'https://www.wikidata.org/wiki/Wikidata:Licensing', feeds: 'Artist descriptions, awards, nominations and record labels' },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org', terms: 'CC BY-SA 4.0', termsUrl: 'https://en.wikipedia.org/wiki/Wikipedia:Copyrights', feeds: 'Artist summaries' },
  { name: 'Wikimedia Commons', url: 'https://commons.wikimedia.org', terms: 'Per file: public domain, CC0, CC BY or CC BY-SA', termsUrl: 'https://commons.wikimedia.org/wiki/Commons:Licensing', feeds: 'Artist photos, each credited with its author, license and file page' },
  { name: 'ListenBrainz', url: 'https://listenbrainz.org', terms: 'CC0', termsUrl: 'https://listenbrainz.org/terms-of-service/', feeds: 'Listener counts and similar artists' },
  { name: 'AcousticBrainz', url: 'https://acousticbrainz.org', terms: 'CC0', termsUrl: 'https://acousticbrainz.org/download', feeds: 'Tempo, key and mood estimates in song comparisons (data stops in 2022)' },
  { name: 'Discogs', url: 'https://www.discogs.com', terms: 'Discogs API terms', termsUrl: 'https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use', feeds: 'More album credits for artist comparisons' },
  { name: 'Genius', url: 'https://genius.com', terms: 'Genius API terms', termsUrl: 'https://genius.com/static/terms', feeds: 'More song credits for artist comparisons', needsKey: true },
  { name: 'Last.fm', url: 'https://www.last.fm', terms: 'Last.fm API terms', termsUrl: 'https://www.last.fm/api/tos', feeds: 'Listener counts and artists similar to both', needsKey: true },
  { name: 'Spotify tracks dataset', url: 'https://huggingface.co/datasets/maharshipandya/spotify-tracks-dataset', terms: 'BSD, as stated by its publisher', termsUrl: 'https://huggingface.co/datasets/maharshipandya/spotify-tracks-dataset', feeds: 'The sound analysis in song comparisons (song_compare)' },
  { name: 'Genius lyrics dataset', url: 'https://huggingface.co/datasets/theelderemo/genius-lyrics-cleaned', terms: 'As stated by its publisher; lyrics are analysed, never shown', termsUrl: 'https://huggingface.co/datasets/theelderemo/genius-lyrics-cleaned', feeds: 'The lyrics analysis in song comparisons (song_compare)' },
];
