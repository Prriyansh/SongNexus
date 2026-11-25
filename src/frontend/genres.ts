// Genres you can add to About Me. Names match MusicBrainz's genre list (lower case), so they
// line up with the genres the API returns for artists and songs.
export const genreFamilies: Record<string, string[]> = {
  Pop: ['pop', 'dance-pop', 'synth-pop', 'electropop', 'indie pop', 'art pop', 'k-pop', 'dream pop', 'teen pop'],
  Rock: ['rock', 'alternative rock', 'indie rock', 'pop rock', 'punk rock', 'post-punk', 'art rock', 'hard rock', 'grunge', 'shoegaze', 'emo'],
  'Hip-Hop': ['hip hop', 'trap', 'pop rap', 'conscious hip hop', 'boom bap', 'drill'],
  'R&B / Soul': ['r&b', 'contemporary r&b', 'neo soul', 'soul', 'funk', 'alternative r&b'],
  Electronic: ['electronic', 'house', 'techno', 'ambient', 'trip hop', 'drum and bass', 'dubstep', 'edm', 'hyperpop'],
  'Folk / Country': ['folk', 'indie folk', 'singer-songwriter', 'country', 'country pop', 'americana', 'bluegrass'],
  'Jazz / Blues': ['jazz', 'smooth jazz', 'jazz fusion', 'blues', 'swing'],
  Latin: ['latin pop', 'reggaeton', 'bachata', 'salsa', 'bossa nova', 'latin trap'],
  Global: ['afrobeats', 'afrobeat', 'reggae', 'dancehall', 'amapiano', 'j-pop', 'bollywood'],
  Metal: ['heavy metal', 'metalcore', 'thrash metal', 'nu metal'],
  Classical: ['classical', 'film score', 'opera', 'minimalism'],
};

export const allGenres = Object.values(genreFamilies).flat();

export const familyOf = (genre: string) =>
  Object.keys(genreFamilies).find(family => genreFamilies[family].includes(genre.toLowerCase())) || 'Genre';
