// @vitest-environment jsdom
// About Me on its own, with the API replaced and time controlled: the overview empty, full, shared
// and named; removing favourites; the "Add to your music taste" screen for every category, with
// searches that fail, find nothing or arrive late; album browsing; paging; importing a playlist.
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtistDetails, Song } from '@/lib/types';
import { emptyProfile } from '../profile';
import type { MusicProfile } from '../profile';
import { killBill, OLIVIA, oliviaDetails, phoebe, taylorDetails, vampireDetails } from './fixtures';

const api = vi.hoisted(() => ({ searchArtists: vi.fn(), searchSongs: vi.fn(), artistDetails: vi.fn() }));
vi.mock('../api', () => api);
import { AboutMe } from '../components/AboutMe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let current: MusicProfile = emptyProfile;
const onSelect = vi.fn();
const onManual = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  api.artistDetails.mockImplementation(() => new Promise(() => {}));
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.innerHTML = ''; vi.useRealTimers(); vi.clearAllMocks(); });

const saved: MusicProfile = {
  artists: [{ id: OLIVIA, name: 'Olivia Rodrigo', subtitle: 'Person', artUrl: null }],
  songs: [{ id: vampireDetails.id, title: 'vampire', artist: 'Olivia Rodrigo', artistId: OLIVIA, album: 'GUTS', year: '2023', duration: '3:39', artUrl: null },
    { id: killBill.id, title: 'Kill Bill', artist: 'SZA', artistId: null, album: '', year: '', duration: '—', artUrl: null }],
  albums: [{ id: 'ab000000-0000-4000-8000-000000000001', title: 'GUTS', artist: 'Olivia Rodrigo', artistId: OLIVIA, year: '2023', artUrl: null },
    { id: 'ab000000-0000-4000-8000-000000000002', title: 'Undated', artist: 'Someone', artistId: null, year: '', artUrl: null }],
  genres: ['pop'],
};

/** About Me with its profile in state, reporting each render's profile so tests can check it. */
function Page({ initial, manual, readOnly, name, report }: { initial: MusicProfile; manual: boolean; readOnly?: boolean; name?: string; report: (p: MusicProfile) => void }) {
  const [profile, setProfile] = useState(initial);
  report(profile);
  return <AboutMe onSelect={onSelect} profile={profile} onProfileChange={setProfile} manual={manual} onManual={onManual} readOnly={readOnly} name={name} />;
}
async function show(props: { initial?: MusicProfile; manual?: boolean; readOnly?: boolean; name?: string } = {}) {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root!.render(<Page initial={props.initial ?? emptyProfile} manual={props.manual ?? false} readOnly={props.readOnly} name={props.name} report={p => { current = p; }} />));
}
const words = () => document.body.textContent ?? '';
const named = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith(name) || b.getAttribute('aria-label') === name)!;
const press = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search music"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}
const cards = () => [...document.querySelectorAll('.catalog-card')].map(c => c.querySelector('strong')!.textContent);

describe('the overview', () => {
  it('invites you to add each kind of music when empty, and opens the right category', async () => {
    await show({ name: 'Alka' });
    expect(words()).toContain('Alka’s taste. Your starting point.');
    for (const label of ['Browse artists', 'Browse genres', 'Browse albums', 'Browse songs']) await press(named(label));
    await press(named('Add an artist, genre, album, or song'));
    await press(named('Add artists'));
    await press(named('Add genres'));
    await press(named('Add albums'));
    await press(named('Add songs'));
    expect(onManual).toHaveBeenCalledTimes(9);
    expect(onManual).toHaveBeenCalledWith(true);
  });

  it('opens and removes favourites, saying what changed, and the note fades', async () => {
    await show({ initial: saved });
    await press([...document.querySelectorAll('.favorite-item')].find(b => b.textContent?.includes('Olivia Rodrigo'))!);
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'artist', id: OLIVIA });
    await press([...document.querySelectorAll('.favorite-item')].find(b => b.textContent?.includes('GUTS'))!);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'album' }));
    await press([...document.querySelectorAll('.saved-song .mini-entity')][0]);
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'song', id: vampireDetails.id });
    for (const label of ['Remove Olivia Rodrigo', 'Remove pop', 'Remove GUTS', 'Remove vampire']) await press(named(label));
    expect(words()).toContain('vampire removed from your music taste.');
    expect(current.artists).toEqual([]);
    expect(current.genres).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(document.querySelector('.toast')!.className).not.toContain('visible');
  });

  it('shows a shared profile without any way to change it', async () => {
    await show({ readOnly: true });
    expect(words()).toContain('A taste worth sharing.');
    expect(words()).toContain('No artists shared.');
    expect(named('Upload Playlist')).toBeUndefined();
    await act(async () => root!.unmount());
    await show({ initial: saved, readOnly: true, manual: true });
    expect(named('Remove Olivia Rodrigo')).toBeUndefined();
    expect(words()).not.toContain('Add to your music taste.');
  });

  it('imports a playlist’s songs and their artists, once each', async () => {
    api.searchSongs.mockImplementation(async (query: string) => query.includes('vampire') ? [vampireDetails] : query.includes('Kill Bill') ? [killBill] : []);
    await show({ initial: { ...emptyProfile, songs: [saved.songs[1]] } });
    await press(named('Upload Playlist'));
    await press(named('Load Sample Playlist'));
    for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await press([...document.querySelectorAll('button')].find(b => b.textContent?.startsWith('Import'))!);
    expect(current.songs.map(s => s.title)).toEqual(['Kill Bill', 'vampire']);
    expect(current.artists.map(a => a.name)).toEqual(['Olivia Rodrigo', 'SZA']);
    expect(words()).toContain('Imported 2 songs and their artists.');
    await press(named('Upload Playlist'));
    await press(named('Close upload'));
    expect(document.querySelector('[aria-label="Upload playlist"]')).toBeNull();
  });
});

describe('adding to your taste', () => {
  const tab = (name: string) => press([...document.querySelectorAll('.catalog-tabs button')].find(b => b.textContent?.includes(name))!);

  it('lists what you have in each category, with or without a year', async () => {
    await show({ initial: saved, manual: true });
    expect(cards()).toEqual(['Olivia Rodrigo']);
    await tab('Songs');
    expect(words()).toContain('Olivia Rodrigo · 2023');
    await tab('Albums');
    expect(cards()).toEqual(['GUTS', 'Undated']);
    expect(words()).toContain('Your albums. Search MusicBrainz to add more.');
    await press(named('Back to About Me'));
    await press(named('Done'));
    expect(onManual).toHaveBeenCalledWith(false);
  });

  it('filters genres, adds and removes one, and pages through them', async () => {
    await show({ manual: true });
    await tab('Genres');
    expect(words()).toContain('Page 1 of');
    await press(named('Next'));
    expect(words()).toContain('Page 2 of');
    await press(named('Previous'));
    await search('jazz');
    await press(document.querySelector('.catalog-card')!);
    expect(current.genres).toEqual(['jazz']);
    await press(document.querySelector('.catalog-card')!);
    expect(current.genres).toEqual([]);
    expect(words()).toContain('Jazz removed from your music taste.');
  });

  it('adds an artist from search, says when nothing matches, and clears the search', async () => {
    api.searchArtists.mockResolvedValueOnce([{ ...phoebe, disambiguation: 'the singer' }]).mockResolvedValueOnce([]);
    await show({ manual: true });
    expect(words()).toContain('Search MusicBrainz for any artist.');
    await search('phoebe');
    expect(words()).toContain('the singer');
    await press(document.querySelector('.catalog-card')!);
    expect(current.artists.map(a => a.name)).toEqual(['Phoebe Bridgers']);
    await search('zzzz');
    expect(words()).toContain('No matches for “zzzz”');
    await press(named('Clear search'));
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Search music"]')!.value).toBe('');
  });

  it('adds a song from search, with its year when known', async () => {
    api.searchSongs.mockResolvedValue([killBill, { ...vampireDetails, releases: [] } as Song]);
    await show({ manual: true });
    await tab('Songs');
    await search('kill');
    expect(words()).toContain('SZA · 2022');
    await press([...document.querySelectorAll('.catalog-card')].find(c => c.textContent?.includes('Kill Bill'))!);
    expect(current.songs.map(s => s.title)).toEqual(['Kill Bill']);
    await press(named('Clear search'));
  });

  it('browses an artist’s albums, lets you pick another artist, and adds an album', async () => {
    const sparseAlbums: ArtistDetails = { ...taylorDetails, discography: { ...taylorDetails.discography!, representative: [{ ...taylorDetails.discography!.representative[0], year: '' }] } };
    api.searchArtists.mockResolvedValue([{ ...phoebe, id: OLIVIA, name: 'Olivia Rodrigo', disambiguation: '' }, { ...phoebe, id: taylorDetails.id, name: 'Taylor Swift', disambiguation: 'pop star' }]);
    api.artistDetails.mockImplementation(async (id: string) => (id === OLIVIA ? oliviaDetails : sparseAlbums));
    await show({ manual: true });
    await tab('Albums');
    await search('swift');
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    // "swift" ranks Taylor Swift first; her undated album shows with no year.
    expect(words()).toContain('Studio albums by Taylor Swift, newest first.');
    await press(document.querySelector('.catalog-card')!);
    expect(current.albums.map(a => a.artist)).toEqual(['Taylor Swift']);
    await press([...document.querySelectorAll('.artist-picker button')].find(b => b.textContent?.includes('Olivia Rodrigo'))!);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(words()).toContain('Studio albums by Olivia Rodrigo');
    expect(words()).toContain('Olivia Rodrigo · 2023');
  });

  it('says when an artist’s albums can’t be loaded', async () => {
    api.searchArtists.mockResolvedValue([phoebe]);
    api.artistDetails.mockRejectedValueOnce(new Error('Albums are down.')).mockResolvedValue({ ...taylorDetails, discography: null });
    await show({ manual: true });
    await tab('Albums');
    await search('phoebe');
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(words()).toContain('Albums are down.');
  });

  it('lists no albums for an artist without a discography', async () => {
    api.searchArtists.mockResolvedValue([phoebe]);
    api.artistDetails.mockResolvedValue({ ...taylorDetails, discography: null });
    await show({ manual: true });
    await tab('Albums');
    await search('phoebe');
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(cards()).toEqual([]);
  });

  it('says when a search fails, and ignores answers to what was typed before', async () => {
    let late!: (v: unknown) => void, lateFail!: (e: unknown) => void;
    api.searchArtists.mockRejectedValueOnce(new Error('MusicBrainz is busy.'))
      .mockImplementationOnce(() => new Promise(r => { late = r; }))
      .mockImplementationOnce(() => new Promise((_, f) => { lateFail = f; }));
    await show({ manual: true });
    await search('phoebe');
    expect(words()).toContain('MusicBrainz is busy.');
    await search('ph');
    await search('pho'); // the answer for "ph" comes after this
    await act(async () => { late([phoebe]); });
    expect(cards()).not.toContain('Phoebe Bridgers');
    await search('phoe');
    await act(async () => { lateFail(new Error('too late')); });
    expect(words()).not.toContain('too late');
  });
});

describe('the rest of About Me', () => {
  const tab = (name: string) => press([...document.querySelectorAll('.catalog-tabs button')].find(b => b.textContent?.includes(name))!);

  it('removes saved music from the cards on the add screen', async () => {
    await show({ initial: saved, manual: true });
    await press(document.querySelector('.catalog-card')!);
    expect(current.artists).toEqual([]);
    await tab('Songs');
    await press(document.querySelector('.catalog-card')!);
    expect(current.songs.map(s => s.title)).toEqual(['Kill Bill']);
    await tab('Albums');
    await press(document.querySelector('.catalog-card')!);
    expect(current.albums.map(a => a.title)).toEqual(['Undated']);
  });

  it('adds an artist beside the ones you have, and clears from the no-matches panel', async () => {
    api.searchArtists.mockResolvedValueOnce([phoebe]).mockResolvedValueOnce([]);
    await show({ initial: saved, manual: true });
    await search('phoebe');
    await press(document.querySelector('.catalog-card')!);
    expect(current.artists.map(a => a.name)).toEqual(['Olivia Rodrigo', 'Phoebe Bridgers']);
    await search('nothing');
    await press(document.querySelector('.catalog-empty button')!);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Search music"]')!.value).toBe('');
  });

  it('imports a playlist without repeating an artist you already have', async () => {
    api.searchSongs.mockImplementation(async (query: string) => (query.includes('vampire') ? [vampireDetails] : []));
    await show({ initial: saved });
    await press(named('Upload Playlist'));
    await press(named('Load Sample Playlist'));
    for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await press([...document.querySelectorAll('button')].find(b => b.textContent?.startsWith('Import'))!);
    expect(current.artists.map(a => a.name)).toEqual(['Olivia Rodrigo']);
  });
});
