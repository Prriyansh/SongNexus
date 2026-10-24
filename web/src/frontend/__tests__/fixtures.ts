// API payloads shaped exactly like our routes' responses (src/lib/types.ts), for frontend tests.
import type { Artist, ArtistDetails, CollaboratorComparison, RecordingDetails, Song } from '@/lib/types';
import { examples } from '../routing';

export const OLIVIA = examples.artist[0];
export const TAYLOR = examples.artist[1];
export const VAMPIRE = examples.song[0];
export const OPHELIA = examples.song[1];
export const SERBAN = 'd1f01df7-fcac-4c64-a530-0f49aacf98bb';
export const BRYCE = '8cbe7c9c-c829-46fc-97ef-08f01b8ea53a';
export const NIGRO = '2a3e4b7c-1111-4222-8333-944455556666';
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
    { id: 'bb000000-0000-4000-8000-000000000001', title: 'SOUR', year: '2021', type: 'Album', artUrl: null },
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
