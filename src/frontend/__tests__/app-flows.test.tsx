// @vitest-environment jsdom
// More of the app driven like a user, for paths app.integration.test.tsx doesn't take: shared
// notes, top songs that can't be matched, similar songs that can't be found, drawers for albums
// and for artists and songs with little on file, the share sheet, and the frame's buttons.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtistDetails, RecordingDetails } from '@/lib/types';
import type { SoundResult } from '@/lib/sound';
import { button, click, DETAILS, fetchMock, render, stored, text, type, world } from './app-harness';
import { collab, OLIVIA, OPHELIA, opheliaDetails, PHOEBE, soundOk, TAYLOR, taylorDetails, VAMPIRE, vampireDetails } from './fixtures';

const SPARSE_ARTIST = 'ab000000-0000-4000-8000-000000000001';
const SPARSE_SONG = 'ab000000-0000-4000-8000-000000000002';
const ALBUM = 'ab000000-0000-4000-8000-000000000003';
const added: string[] = [];
const addDetails = (id: string, details: unknown) => { DETAILS[id] = details; added.push(id); };
afterEach(() => { for (const id of added.splice(0)) delete DETAILS[id]; });

/** Answers one route differently, leaving the rest to the harness. */
function answer(path: string, reply: (url: URL) => Response | Promise<Response>) {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input: string) => {
    const url = new URL(input, 'http://localhost');
    return url.pathname === path ? reply(url) : original(input);
  });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const drawer = () => document.querySelector('.detail-drawer');

describe('Explore', () => {
  it('shows a shared note and lets it be dismissed, keeping the comparison', async () => {
    await render(`/compare/artists?artistA=${OLIVIA}&artistB=${TAYLOR}&note=Same+mixer`);
    expect(text()).toContain('Shared with a note');
    await click(button('Dismiss shared note'));
    expect(text()).not.toContain('Same mixer');
    expect(new URLSearchParams(window.location.search).get('artistA')).toBe(OLIVIA);
    expect(new URLSearchParams(window.location.search).has('note')).toBe(false);
  });

  it('says which artist’s top song couldn’t be matched', async () => {
    answer('/api/top-track', url => json({ track: url.searchParams.get('id') === TAYLOR ? null : vampireDetails }));
    await render('/compare/artists');
    await click(button('Compare their top songs'));
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Couldn’t match a top song for Taylor Swift on MusicBrainz.');
  });

  it('says why finding top songs failed', async () => {
    answer('/api/top-track', () => json({ error: 'Deezer is busy.' }, 400));
    await render('/compare/artists');
    await click(button('Compare their top songs'));
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Deezer is busy.');
  });

  it('says when no one is credited on both artists’ albums', async () => {
    answer('/api/musicbrainz/collaborators', () => json({ collaborators: { ...collab, mutual: [] } }));
    await render('/compare/artists');
    expect(document.querySelector('.insights')!.textContent).toContain('No one is credited on both artists’ scanned albums.');
  });

  it('says when a similar-sounding song can’t be found, or the search fails', async () => {
    const ok = soundOk as Extract<SoundResult, { status: 'ok' }>;
    world.sound = { ...ok, similar: { a: [{ ...ok.similar.a[0], artists: [] }], b: [] } };
    answer('/api/musicbrainz/search', () => json({ results: [] }));
    await render(`/compare/songs?songA=${VAMPIRE}&songB=${OPHELIA}`);
    await click(document.querySelector('.similar-panel .mini-entity')!);
    expect(text()).toContain('Couldn’t find “Kill Bill” on MusicBrainz.');
    answer('/api/musicbrainz/search', () => json({ error: 'Search is down.' }, 400));
    await click(document.querySelector('.similar-panel .mini-entity')!);
    expect(text()).toContain('Search is down.');
  });

  it('describes a chosen artist with little on file by what is known', async () => {
    addDetails(SPARSE_ARTIST, { ...taylorDetails, id: SPARSE_ARTIST, name: 'Sparse', genres: [], area: '', country: '', type: 'Group' });
    await render(`/compare/artists?artistA=${SPARSE_ARTIST}&artistB=${OLIVIA}`);
    expect(document.querySelector('.selected-card small')!.textContent).toBe('Group');
  });
});

describe('the details drawer', () => {
  it('shows a saved album, opens its artist, and handles one without a year or artist', async () => {
    const album = { id: ALBUM, title: 'Saved Album', artist: 'Olivia Rodrigo', artistId: OLIVIA, year: '2021', artUrl: null };
    const bare = { ...album, id: 'ab000000-0000-4000-8000-000000000004', title: 'Bare Album', artistId: null, year: '' };
    localStorage.setItem('song-nexus-profile', JSON.stringify({ artists: [], songs: [], albums: [album, bare], genres: [] }));
    await render('/about');
    await click([...document.querySelectorAll('button')].find(b => b.textContent?.includes('Saved Album'))!);
    expect(drawer()!.getAttribute('aria-label')).toBe('Album details');
    expect(drawer()!.textContent).toContain('Olivia Rodrigo · 2021');
    await click(button('In your taste'));
    expect(stored().albums.map((a: { id: string }) => a.id)).not.toContain(ALBUM);
    await click(drawer()!.querySelector('.drawer-section .mini-entity')!);
    expect(drawer()!.getAttribute('aria-label')).toBe('Artist details');
    await click(button('Close details'));
    expect(drawer()).toBeNull();
    await click([...document.querySelectorAll('button')].find(b => b.textContent?.includes('Bare Album'))!);
    expect(drawer()!.textContent).not.toContain('Artist');
  });

  it('says when an artist couldn’t be loaded, and tries again', async () => {
    await render('/compare/artists');
    // Collaborators have no details in the fake API, so theirs fail to load.
    await click(button('Serban Ghenea · Mixing ↗'));
    expect(drawer()!.querySelector('[role="alert"]')!.textContent).toContain('Not found');
    const asked = fetchMock.mock.calls.length;
    await click(button('Try again'));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(asked);
  });

  it('shows an artist with little on file, and adds and removes one of their albums', async () => {
    const sparse: ArtistDetails = {
      ...taylorDetails, id: SPARSE_ARTIST, name: 'Sparse', lifeSpan: {}, area: '', country: '', rating: { value: 4.25, votes: 8 },
      discography: { ...taylorDetails.discography!, representative: [{ ...taylorDetails.discography!.representative[0], year: '' }], complete: true, albumCount: 1, studioAlbumCount: 1 },
      links: [],
    };
    addDetails(SPARSE_ARTIST, sparse);
    await render(`/compare/artists?artistA=${SPARSE_ARTIST}&artistB=${OLIVIA}`);
    await click(document.querySelector('.selected-card')!);
    const words = drawer()!.textContent!;
    for (const expected of ['—', '4.3 / 5 (8)', 'newest first', 'Year unknown']) expect(words).toContain(expected);
    const heart = drawer()!.querySelector<HTMLButtonElement>('.album-row .icon-button')!;
    await click(heart);
    expect(heart.getAttribute('aria-label')).toMatch(/^Remove .* from your taste$/);
    await click(heart);
    expect(heart.getAttribute('aria-label')).toMatch(/^Add .* to your taste$/);
  });

  it('says an artist has no studio albums listed', async () => {
    addDetails(SPARSE_ARTIST, { ...taylorDetails, id: SPARSE_ARTIST, name: 'No Albums', discography: null });
    await render(`/compare/artists?artistA=${SPARSE_ARTIST}&artistB=${OLIVIA}`);
    await click(document.querySelector('.selected-card')!);
    expect(drawer()!.textContent).toContain('No studio albums listed on MusicBrainz.');
  });

  it('shows a song with little on file', async () => {
    const sparse: RecordingDetails = {
      ...opheliaDetails, id: SPARSE_SONG, title: 'Sparse Song', representative: null, genres: [], tags: ['ballad'], disambiguation: 'demo', firstReleaseDate: '', durationMs: null,
      rating: { value: 3, votes: 2 }, artists: [{ id: null, name: 'Uncredited' }, { id: TAYLOR, name: 'Taylor Swift' }], releases: [{ id: 'cc000000-0000-4000-8000-0000000000ff', title: 'Undated Release', date: '' }],
    };
    addDetails(SPARSE_SONG, sparse);
    await render(`/compare/songs?songA=${SPARSE_SONG}&songB=${VAMPIRE}`);
    await click(document.querySelector('.selected-card')!);
    const words = drawer()!.textContent!;
    for (const expected of ['Ballad', 'demo', '3.0 / 5', 'Uncredited', 'Date unknown']) expect(words).toContain(expected);
    expect(words).not.toContain('Sparse Song · ');
  });

  it('compares from a song’s drawer while artists are being compared, keeping nothing of the artist pair', async () => {
    await render(`/compare/artists?artistA=${OLIVIA}&artistB=${TAYLOR}`);
    await click(button('Compare “vampire” and “The Fate of Ophelia”'));
    await click(document.querySelector('.selected-card')!);
    await click([...drawer()!.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Compare')!);
    expect(window.location.pathname).toBe('/compare/songs');
    expect(new URLSearchParams(window.location.search).get('songA')).toBe(VAMPIRE);
  });

  it('keeps the other side when comparing from the left card’s own drawer', async () => {
    await render(`/compare/artists?artistA=${OLIVIA}&artistB=${TAYLOR}`);
    await click(document.querySelector('.selected-card')!);
    await click([...drawer()!.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Compare')!);
    expect(new URLSearchParams(window.location.search).get('artistB')).toBe(TAYLOR);
  });
});

describe('sharing', () => {
  const withShare = async (path: string, title: string) => {
    const share = vi.fn(() => Promise.reject(new Error('cancelled')));
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    try {
      await render(path);
      await click(button('Share'));
      await click(button('Share via...'));
      expect(share).toHaveBeenCalledWith(expect.objectContaining({ title }));
      expect(document.querySelector('.share-modal')).not.toBeNull(); // closing the sheet isn't a failure
      await click(button('Close share'));
      expect(document.querySelector('.share-modal')).toBeNull();
    } finally {
      delete (navigator as { share?: unknown }).share;
    }
  };
  it('offers the device’s share sheet for a comparison', () => withShare('/compare/artists', 'Song Nexus comparison'));
  it('offers the device’s share sheet for About Me', () => withShare('/about', 'Song Nexus music profile'));
});

describe('the frame', () => {
  it('goes home from the wordmark, and keeps the menu open for keys other than Escape', async () => {
    await render('/compare/artists');
    await click(button('Open navigation'));
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })); });
    expect(document.querySelector('.sidebar')!.classList).toContain('open');
    await click(document.querySelector('.header-wordmark')!);
    expect(window.location.pathname).toBe('/about');
  });

  it('returns from a shared profile to your own', async () => {
    const profile = { artists: [{ id: OLIVIA, name: 'Olivia Rodrigo', subtitle: '', artUrl: null }], songs: [], albums: [], genres: [] };
    await render(`/about?profile=${encodeURIComponent(JSON.stringify(profile))}`);
    await click(button('View my About Me'));
    expect(text()).not.toContain('Shared About Me');
    expect(window.location.search).toBe('');
  });

  it('doesn’t replace a playlist already saved when setup asks for something new', async () => {
    localStorage.removeItem('song-nexus-setup');
    const kept = { name: 'Kept', songs: [{ title: 'Old', artist: 'Song' }] };
    localStorage.setItem('song-nexus-playlist', JSON.stringify(kept));
    await render('/about');
    await click(button('Skip')); await click(button('Skip'));
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Search songs"]')!, 'vampire');
    await click(button('vampire'));
    await click(button('Next'));
    await click(button('Something new for me'));
    await click(button('Next'));
    await click(button('Skip and finish'));
    expect(new URLSearchParams(window.location.search).get('mode')).toBe('playlist');
    expect(JSON.parse(localStorage.getItem('song-nexus-playlist')!)).toEqual(kept);
  });
});

describe('the rest of Explore and its drawer', () => {
  it('swaps the first artist from its picker', async () => {
    await render('/compare/artists');
    await click(document.querySelectorAll('.chooser-button')[0]);
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Search artists"]')!, 'Phoebe');
    await click(button('Phoebe Bridgers'));
    expect(new URLSearchParams(window.location.search).get('artistA')).toBe(PHOEBE);
  });

  it('names the first artist when it’s their top song that can’t be matched', async () => {
    answer('/api/top-track', url => json({ track: url.searchParams.get('id') === OLIVIA ? null : vampireDetails }));
    await render('/compare/artists');
    await click(button('Compare their top songs'));
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Couldn’t match a top song for Olivia Rodrigo on MusicBrainz.');
  });

  it('retries both artists from the graph when one didn’t load', async () => {
    world.failures[`/api/musicbrainz/details:${TAYLOR}`] = 2;
    await render('/compare/artists');
    const graphError = document.querySelector('.graph-panel [role="alert"]')!;
    expect(graphError.textContent).toContain('MusicBrainz is busy right now.');
    await click(graphError.querySelector('button')!);
    expect(document.querySelector('.graph-panel [role="alert"]')).toBeNull();
  });

  it('opens the people behind the music, artists and collaborators alike', async () => {
    await render('/compare/artists');
    const people = () => [...document.querySelectorAll('.quick-peek .mini-entity')];
    await click(people().find(p => p.textContent?.includes('Taylor Swift'))!);
    expect(drawer()!.textContent).toContain('Taylor Swift');
    await click(button('Close details'));
    await click(people().find(p => p.textContent?.includes('Worked with both'))!);
    expect(drawer()).not.toBeNull();
  });

  it('keeps the second artist when comparing from the first one’s drawer', async () => {
    await render(`/compare/artists?artistA=${TAYLOR}&artistB=${PHOEBE}`);
    await click(document.querySelector('.selected-card')!);
    await click([...drawer()!.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Compare')!);
    expect(new URLSearchParams(window.location.search).get('artistB')).toBe(PHOEBE);
  });

  it('adds a song to your taste from its drawer', async () => {
    await render(`/compare/songs?songA=${VAMPIRE}&songB=${OPHELIA}`);
    await click(document.querySelector('.selected-card')!);
    await click(button('Add to your taste'));
    expect(stored().songs.map((s: { id: string }) => s.id)).toEqual([VAMPIRE]);
  });

  it('shows a dash for an artist without a rating', async () => {
    addDetails(SPARSE_ARTIST, { ...taylorDetails, id: SPARSE_ARTIST, name: 'Unrated', rating: null });
    await render(`/compare/artists?artistA=${SPARSE_ARTIST}&artistB=${OLIVIA}`);
    await click(document.querySelector('.selected-card')!);
    expect(drawer()!.textContent).toContain('Rating—');
  });
});

describe('the rest of the frame and sharing', () => {
  it('goes home from the sidebar’s brand', async () => {
    await render('/compare/artists');
    await click(document.querySelector('.sidebar .brand')!);
    expect(window.location.pathname).toBe('/about');
  });

  it('selects the whole link when it’s focused, to copy by hand', async () => {
    await render('/compare/artists');
    await click(button('Share'));
    const link = document.querySelector<HTMLInputElement>('#share-url')!;
    await act(async () => { link.dispatchEvent(new FocusEvent('focus')); link.focus(); });
    expect([link.selectionStart, link.selectionEnd]).toEqual([0, link.value.length]);
  });
});

describe('comparing from About Me', () => {
  it('starts a song comparison from a saved song, though the last comparison was of artists', async () => {
    const song = { id: VAMPIRE, title: 'vampire', artist: 'Olivia Rodrigo', artistId: OLIVIA, album: '', year: '', duration: '—', artUrl: null };
    localStorage.setItem('song-nexus-profile', JSON.stringify({ artists: [], songs: [song], albums: [], genres: [] }));
    await render('/about');
    await click([...document.querySelectorAll('button')].find(b => b.textContent?.includes('vampire'))!);
    expect(drawer()!.getAttribute('aria-label')).toBe('Song details');
    await click([...drawer()!.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Compare')!);
    expect(window.location.pathname).toBe('/compare/songs');
    expect(new URLSearchParams(window.location.search).get('songA')).toBe(VAMPIRE);
  });
});
