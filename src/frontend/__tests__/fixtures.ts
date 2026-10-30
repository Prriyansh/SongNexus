// API payloads shaped exactly like our routes' responses (src/lib/types.ts), for frontend tests.
import type { Artist, ArtistDetails, CollaboratorComparison, RecordingDetails, SimilarNode, SimilarWeb, Song } from '@/lib/types';
import type { SoundResult, SoundTrack } from '@/lib/sound';
import { examples } from '../routing';

export const OLIVIA = examples.artist[0];
export const TAYLOR = examples.artist[1];
export const VAMPIRE = examples.song[0];
export const OPHELIA = examples.song[1];
export const SERBAN = 'd1f01df7-fcac-4c64-a530-0f49aacf98bb';
export const BRYCE = '8cbe7c9c-c829-46fc-97ef-08f01b8ea53a';
export const NIGRO = '2a3e4b7c-1111-4222-8333-944455556666';
export const SOUR_ART = 'https://coverartarchive.org/release-group/bb000000-0000-4000-8000-000000000001/front-250';
export const PHOEBE = '0f2d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b';
export const PUNISHER = '6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e';
export const MAKING_THE_BED = 'aa000000-0000-4000-8000-000000000001';
export const EXPECTATIONS = 'aa000000-0000-4000-8000-000000000002';
export const PATIENT_ZERO = 'aa000000-0000-4000-8000-000000000003';

export const oliviaDetails: ArtistDetails = {
  id: OLIVIA, name: 'Olivia Rodrigo', disambiguation: 'US singer-songwriter', country: 'US', type: 'Person',
  tags: ['pop'], lifeSpan: { begin: '2003-02-20' }, gender: 'Female', area: 'United States',
  genres: [{ name: 'pop', count: 9 }, { name: 'pop rock', count: 6 }, { name: 'pop punk', count: 4 }],
  rating: { value: 4.3, votes: 11 },
  discography: { albumCount: 4, studioAlbumCount: 3, complete: true, firstYear: '2021', lastYear: '2026', representative: [
    { id: 'bb000000-0000-4000-8000-000000000001', title: 'SOUR', year: '2021', type: 'Album', artUrl: 'https://coverartarchive.org/release-group/bb000000-0000-4000-8000-000000000001/front-250' },
    { id: 'bb000000-0000-4000-8000-000000000002', title: 'GUTS', year: '2023', type: 'Album', artUrl: null },
  ] },
  links: [
    { type: 'streaming', url: 'https://music.apple.com/us/artist/1' },
    { type: 'purchase for download', url: 'https://music.apple.com/us/artist/1' },
    { type: 'free streaming', url: 'https://open.spotify.com/artist/x' },
  ],
};

export const taylorDetails: ArtistDetails = {
  id: TAYLOR, name: 'Taylor Swift', disambiguation: '', country: 'US', type: 'Person',
  tags: ['pop'], lifeSpan: { begin: '1989-12-13' }, gender: 'Female', area: 'United States',
  genres: [{ name: 'pop', count: 20 }, { name: 'country', count: 12 }, { name: 'pop rock', count: 3 }],
  rating: { value: 4.2, votes: 40 },
  discography: { albumCount: 74, studioAlbumCount: 18, complete: true, firstYear: '2006', lastYear: '2025', representative: [
    { id: 'bb000000-0000-4000-8000-000000000003', title: '1989', year: '2014', type: 'Album', artUrl: null },
  ] },
  links: [],
};

export const collab: CollaboratorComparison = {
  mutual: [
    { id: SERBAN, name: 'Serban Ghenea', roles: { a: ['mixing'], b: ['mixing'] }, trackCount: { a: 12, b: 30 },
      tracks: { a: [{ id: VAMPIRE, title: 'vampire' }, { id: MAKING_THE_BED, title: 'making the bed' }], b: [{ id: OPHELIA, title: 'The Fate of Ophelia' }] } },
    { id: BRYCE, name: 'Bryce Bordone', roles: { a: ['mixing'], b: ['engineering', 'mixing'] }, trackCount: { a: 10, b: 20 },
      tracks: { a: [{ id: VAMPIRE, title: 'vampire' }], b: [{ id: OPHELIA, title: 'The Fate of Ophelia' }] } },
    { id: NIGRO, name: 'Dan Nigro', roles: { a: ['producer'], b: ['producer'] }, trackCount: { a: 20, b: 1 },
      tracks: { a: [{ id: VAMPIRE, title: 'vampire' }], b: [{ id: OPHELIA, title: 'The Fate of Ophelia' }] } },
  ],
  direct: { bOnA: [], aOnB: [] },
  coverage: { a: { scanned: 3, total: 3, unit: 'albums' }, b: { scanned: 3, total: 18, unit: 'albums' } },
};

const recording = (id: string, title: string, artist: { id: string; name: string }, extra: Partial<RecordingDetails> = {}): RecordingDetails => ({
  id, title, durationMs: 220_000, disambiguation: '', artists: [artist], tags: ['pop'],
  releases: [{ id: 'cc000000-0000-4000-8000-000000000001', title: `${title} (single)`, date: '2023-06-30' }],
  genres: [{ name: 'pop', count: 3 }, { name: 'ballad', count: 1 }], rating: null, firstReleaseDate: '2023-06-30',
  representative: { id: 'cc000000-0000-4000-8000-000000000001', title: `${title} (single)`, year: '2023', type: 'Release', artUrl: 'https://coverartarchive.org/release/cc000000-0000-4000-8000-000000000001/front-250' },
  links: [], ...extra,
});

export const vampireDetails = recording(VAMPIRE, 'vampire', { id: OLIVIA, name: 'Olivia Rodrigo' });
export const opheliaDetails = recording(OPHELIA, 'The Fate of Ophelia', { id: TAYLOR, name: 'Taylor Swift' }, { firstReleaseDate: '2025-10-03', genres: [{ name: 'pop', count: 4 }, { name: 'synth-pop', count: 2 }] });
export const expectationsDetails = recording(EXPECTATIONS, 'expectations', { id: OLIVIA, name: 'Olivia Rodrigo' });
export const patientZeroDetails = recording(PATIENT_ZERO, 'Patient Zero', { id: TAYLOR, name: 'Taylor Swift' });

export const phoebe: Artist = { id: PHOEBE, name: 'Phoebe Bridgers', disambiguation: '', country: 'US', type: 'Person', tags: [], lifeSpan: { begin: '1994-08-17' } };
export const phoebeDetails: ArtistDetails = {
  ...phoebe, gender: 'Female', area: 'United States', genres: [{ name: 'indie folk', count: 5 }], rating: null, links: [],
  discography: { albumCount: 3, studioAlbumCount: 2, complete: true, firstYear: '2017', lastYear: '2020', representative: [
    { id: 'bb000000-0000-4000-8000-000000000010', title: 'Stranger in the Alps', year: '2017', type: 'Album', artUrl: null },
    { id: PUNISHER, title: 'Punisher', year: '2020', type: 'Album', artUrl: 'https://coverartarchive.org/release-group/x/front-250' },
  ] },
};

export const killBill: Song = {
  id: 'aa000000-0000-4000-8000-000000000009', title: 'Kill Bill', durationMs: 153_000, disambiguation: '',
  artists: [{ id: 'dd000000-0000-4000-8000-000000000001', name: 'SZA' }], tags: [],
  releases: [{ id: 'cc000000-0000-4000-8000-000000000009', title: 'SOS', date: '2022-12-09' }, { id: 'cc000000-0000-4000-8000-00000000000a', title: 'Hits 2023', date: '2023-05-01' }],
};

// /api/sound for the default song pair (Spotify dataset ids, not MusicBrainz ids).
const soundTrack = (id: string, title: string, artist: string, energy: number): SoundTrack => ({
  id, title, artists: [artist], album: `${title} album`, genre: 'pop', has_lyrics: true, popularity: 80, duration_ms: 220_000,
  explicit: false, tempo: 144, key: 10, mode: 1, key_name: 'A# major', time_signature: 4,
  audio: { tempo: 144, energy, danceability: 0.58, valence: 0.13, acousticness: 0.72, loudness: -8.8, speechiness: 0.06, instrumentalness: 0, liveness: 0.1 },
  lyrics: { sentiment: { compound: -0.3, positive_share: 0.1, negative_share: 0.4 }, emotions: {}, top_emotion: 'sadness', themes: {}, top_themes: ['heartbreak', 'romance'],
    structure: { verses: 2, choruses: 3, bridges: 1, has_intro: false, has_outro: true, sections_total: 7, lines: 40, words: 300, repetition: 0.3, lexical_diversity: 0.4 } },
});
export const soundOk: SoundResult = {
  status: 'ok',
  comparison: {
    a: soundTrack('sp-a', 'vampire', 'Olivia Rodrigo', 0.43), b: soundTrack('sp-b', 'The Fate of Ophelia', 'Taylor Swift', 0.68),
    overall: 0.71, audio: { score: 0.74, distance: 0.2, per_feature: {} as never },
    lyrics: { score: 0.66, semantic: 0.5, vocabulary: 0.1, themes: 0.9, sentiment: 0.95, shared_themes: ['heartbreak'], emotion_a: 'sadness', emotion_b: 'sadness' },
    credits: { artists: [], same_album: false, same_genre: true, genre: 'pop', album: null },
    structure: { tempo: { a: 138, b: 128, half_double_match: false }, key: { a: 'A# major', b: 'F major', relation: 'closely related key' },
      time_signature: { a: 4, b: null }, duration_sec: { a: 220, b: 226 } },
    reasons: ['Keys are compatible (closely related key).', 'Both lean toward sadness.'],
  },
  similar: { a: [{ id: 'sp-sim', title: 'Kill Bill', artists: ['SZA'], album: 'SOS', genre: 'pop', has_lyrics: true, score: 0.93, shares_artist: false }], b: [] },
};

const similarArtist = (id: string, name: string, similarity: number, rank: number): SimilarNode => ({
  kind: 'artist', id, name, subtitle: 'pop', imageUrl: null, similarity, rank, listeners: 1200,
  reasons: [{ kind: 'listeners', text: `People who play Olivia Rodrigo often play ${name} in the same listening sessions.`, sourceUrl: `https://listenbrainz.org/artist/${id}` }, { kind: 'style', text: 'Both tagged pop on MusicBrainz.' }],
});

export const similarWeb: SimilarWeb = {
  center: { kind: 'artist', id: OLIVIA, name: 'Olivia Rodrigo', subtitle: 'pop', imageUrl: null, similarity: 1, rank: 0, listeners: 18915, reasons: [] },
  artists: [similarArtist(TAYLOR, 'Taylor Swift', .97, 0), similarArtist(PHOEBE, 'Phoebe Bridgers', .4, 1)],
  songs: [{ kind: 'song', id: OPHELIA, name: 'The Fate of Ophelia', subtitle: 'Taylor Swift', artist: 'Taylor Swift', imageUrl: null, similarity: .8, rank: 0, listeners: null,
    reasons: [{ kind: 'listeners', text: 'People who play “vampire” by Olivia Rodrigo often play this in the same listening sessions.' }] }],
  links: [{ from: TAYLOR, to: OPHELIA, kind: 'performed' }, { from: TAYLOR, to: PHOEBE, kind: 'listeners' }],
  sources: [{ source: 'ListenBrainz', status: 'ok' }, { source: 'Deezer', status: 'ok' }],
  seedSongs: ['vampire'],
};
