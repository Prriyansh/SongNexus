import type { Artist, Song } from '@/lib/types';
import type { SoundTrackBrief } from '@/lib/sound';
import { genreFamilies } from './genres';
import type { MusicProfile } from './profile';

type SearchResult = Artist | Song | SoundTrackBrief;
type Credit = { id: string | null; name: string };

const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const nameKey = (value: string) => normalize(value).replace(/ /g, '');
const isArtist = (item: SearchResult): item is Artist => !('title' in item);
const isDatasetSong = (item: SearchResult): item is SoundTrackBrief => 'has_lyrics' in item;
const titleOf = (item: SearchResult) => isArtist(item) ? item.name : item.title;
const creditsOf = (item: SearchResult): Credit[] => isArtist(item) ? [{ id: item.id, name: item.name }]
  : isDatasetSong(item) ? item.artists.map(name => ({ id: null, name })) : item.artists;

const genreKey = (value: string) => {
  const key = normalize(value);
  return key === 'r n b' || key === 'rhythm and blues' ? 'r b' : key === 'hiphop' ? 'hip hop' : key;
};
const broadGenres = new Set(['pop', 'rock', 'hip hop', 'r b', 'electronic', 'folk', 'country', 'jazz', 'blues', 'metal', 'classical']);
// These families have a single broad genre; combined families such as Folk / Country
// must not make a preference for folk match every country artist.
const childGenres = new Map(Object.entries(genreFamilies)
  .filter(([family]) => ['Pop', 'Rock', 'Hip-Hop', 'Electronic', 'Metal', 'Classical'].includes(family))
  .map(([family, genres]) => [genreKey(family), new Set(genres.map(genreKey))]));

function matchesGenre(tags: string[], favorites: string[]) {
  return tags.some(tag => {
    const actual = genreKey(tag);
    return favorites.some(favorite => actual === favorite || (broadGenres.has(favorite)
      && (actual.startsWith(`${favorite} `) || actual.endsWith(` ${favorite}`) || childGenres.get(favorite)?.has(actual))));
  });
}

function textMatch(value: string, query: string, tokens: string[]) {
  const text = normalize(value);
  if (!text || !query) return 0;
  if (text === query || nameKey(text) === nameKey(query)) return 4;
  if (text.startsWith(`${query} `)) return 3;
  const words = new Set(text.split(' '));
  if (tokens.every(token => words.has(token))) return 2;
  return text.includes(query) ? 1 : 0;
}

/** Reorder returned matches locally; provider order remains the final relevance/popularity signal. */
export function rankSearchResults<T extends SearchResult>(
  items: readonly T[], query: string, profile: MusicProfile, options: { preferArtists?: boolean } = {},
): T[] {
  const favorites: Credit[] = [
    ...profile.artists.map(artist => ({ id: artist.id, name: artist.name })),
    ...[...profile.songs, ...profile.albums].map(item => ({ id: item.artistId, name: item.artist })),
  ];
  const favoriteIds = new Set(favorites.flatMap(artist => artist.id ? [artist.id] : []));
  const favoriteNames = new Set(favorites.map(artist => nameKey(artist.name)).filter(Boolean));
  const namesWithIds = new Set(favorites.filter(artist => artist.id).map(artist => nameKey(artist.name)));
  const favoriteArtist = (credit: Credit) => credit.id
    ? favoriteIds.has(credit.id) || (favoriteNames.has(nameKey(credit.name)) && !namesWithIds.has(nameKey(credit.name)))
    : favoriteNames.has(nameKey(credit.name));
  const favoriteSongIds = new Set(profile.songs.map(song => song.id));
  const favoriteGenres = profile.genres.map(genreKey).filter(Boolean);
  const q = normalize(query);
  const tokens = q.split(' ').filter(Boolean);
  const seen = new Set<string>();

  return items.flatMap((item, index) => {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof titleOf(item) !== 'string' || !titleOf(item).trim()) return [];
    if (isArtist(item) && (/^(\[unknown\]|\[no artist\]|various artists)$/i.test(item.name.trim())
      || (item.tags ?? []).some(tag => /(?:^| )special purpose(?: |$)/.test(normalize(tag))))) return [];
    if (seen.has(item.id)) return [];
    seen.add(item.id);

    const credits = creditsOf(item);
    const hasFavoriteArtist = credits.some(favoriteArtist);
    const tags = isDatasetSong(item) ? [item.genre ?? ''] : item.tags ?? [];
    const hasFavoriteGenre = matchesGenre(tags, favoriteGenres);
    const savedSong = !isArtist(item) && (isDatasetSong(item)
      ? profile.songs.some(song => nameKey(song.title) === nameKey(item.title)
        && (credits.some(credit => nameKey(credit.name) === nameKey(song.artist))
          || nameKey(credits.map(credit => credit.name).join(', ')) === nameKey(song.artist)))
      : favoriteSongIds.has(item.id));
    const preference = savedSong || (options.preferArtists && hasFavoriteArtist) ? 2 : hasFavoriteArtist || hasFavoriteGenre ? 1 : 0;

    const context = isArtist(item) ? [] : [
      ...credits.map(credit => credit.name),
      ...(isDatasetSong(item) ? [item.album ?? ''] : item.releases.map(release => release.title)),
    ];
    const primary = textMatch(titleOf(item), q, tokens);
    const secondary = Math.max(0, ...context.map(value => textMatch(value, q, tokens)));
    const combined = normalize([titleOf(item), ...context].join(' ')).split(' ');
    const combinedMatch = q && tokens.every(token => combined.includes(token)) ? 2 : 0;
    const relevance = Math.max(primary * 2, secondary ? secondary * 2 - 1 : 0, combinedMatch);
    return [{ item, index, preference, relevance }];
  }).sort((a, b) => b.preference - a.preference || b.relevance - a.relevance || a.index - b.index)
    .map(result => result.item);
}
