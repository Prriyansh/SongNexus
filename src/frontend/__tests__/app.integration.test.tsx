// @vitest-environment jsdom
// Renders the whole app (Helen's screens) against a mocked version of our API routes and drives it
// like a user: deep links, comparisons, collaborators, top songs, About Me, drawer, share, playlist.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/lib/types';
import {
  collab, SOUR_ART, EXPECTATIONS, expectationsDetails, killBill, OLIVIA, oliviaDetails, OPHELIA, opheliaDetails, PATIENT_ZERO,
  patientZeroDetails, PHOEBE, phoebe, phoebeDetails, PUNISHER, TAYLOR, taylorDetails, VAMPIRE, vampireDetails,
} from './fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DETAILS: Record<string, unknown> = {
  [OLIVIA]: oliviaDetails, [TAYLOR]: taylorDetails, [PHOEBE]: phoebeDetails,
  [VAMPIRE]: vampireDetails, [OPHELIA]: opheliaDetails, [EXPECTATIONS]: expectationsDetails, [PATIENT_ZERO]: patientZeroDetails,
};
const vampireSong: Song = { ...vampireDetails };
let failures: Record<string, number> = {};
const fetchMock = vi.fn(async (input: string) => {
  const url = new URL(input, 'http://localhost');
  const q = url.searchParams;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const key = `${url.pathname}:${q.get('id') ?? ''}`;
  if (failures[key]) { failures[key]--; return reply({ error: 'MusicBrainz is busy right now.', retryable: true }, 503); }
  switch (url.pathname) {
    case '/api/musicbrainz/details': return DETAILS[q.get('id')!] ? reply({ details: DETAILS[q.get('id')!] }) : reply({ error: 'Not found' }, 404);
    case '/api/musicbrainz/collaborators': return reply({ collaborators: collab });
    case '/api/top-track': return reply({ track: q.get('id') === OLIVIA ? expectationsDetails : patientZeroDetails });
    case '/api/musicbrainz/search': {
      const query = q.get('q') ?? '';
      if (q.get('type') === 'artist') return reply({ results: /phoebe/i.test(query) ? [phoebe] : [] });
      return reply({ results: /vampire/i.test(query) ? [vampireSong] : /Kill Bill/.test(query) ? [killBill] : [] });
    }
  }
  return reply({ error: 'unknown route' }, 404);
});

let root: Root | null = null;
let App: typeof import('../App').default;

beforeEach(async () => {
  vi.resetModules(); // fresh api memo per test
  failures = {};
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  localStorage.clear();
  App = (await import('../App')).default;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const settle = async (ms = 0) => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
async function render(path: string) {
  window.history.replaceState(null, '', path);
  const container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  await settle();
}
const text = () => document.body.textContent ?? '';
const buttons = () => [...document.querySelectorAll('button')];
const button = (label: string) => {
  const found = buttons().find(b => b.textContent?.includes(label) || b.getAttribute('aria-label') === label);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await settle(); };
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(120); // past the 300 ms search debounce
}
const called = (part: string) => fetchMock.mock.calls.some(([url]) => String(url).includes(part));
const stored = () => JSON.parse(localStorage.getItem('song-nexus-profile') || 'null');

describe('Explore: artists', () => {
  it('renders a shared comparison link with details, collaborators, graph and insights', async () => {
    await render(`/compare/artists?artistA=${OLIVIA}&artistB=${TAYLOR}`);
    expect(called(`/api/musicbrainz/details?type=artist&id=${OLIVIA}`)).toBe(true);
    expect(called(`/api/musicbrainz/collaborators?a=${OLIVIA}&b=${TAYLOR}`)).toBe(true);
    const details = document.querySelector('.comparison-details')!.textContent!;
    expect(details).toContain('Born 2003-02-20');
    expect(details).toContain('3 studio albums');
    expect(details).toContain('Debut album 2021');
    expect(details).toContain('Shared genres');
    expect(document.querySelector('.collab-list')!.textContent).toContain('Serban Ghenea');
    expect(text()).toContain('Scanned Olivia Rodrigo’s 3 most recent studio albums and Taylor Swift’s 3 most recent studio albums.');
    const nodes = [...document.querySelectorAll('.graph-node')].map(n => n.getAttribute('aria-label'));
    expect(nodes.some(label => label?.startsWith('Serban Ghenea'))).toBe(true);
    expect(text()).toContain('Neither is credited on the other’s scanned albums.');
  });

  it('shows album covers for artists and their albums', async () => {
    await render('/compare/artists');
    const cardImages = [...document.querySelectorAll('.selected-card img')].map(img => img.getAttribute('src'));
    expect(cardImages).toEqual([SOUR_ART]); // Olivia has a cover; Taylor's fixture albums have none
    const strip = [...document.querySelectorAll('.comparison-details .album-thumb')];
    expect(strip.map(a => a.textContent)).toEqual(['GUTS2023', 'SOUR2021', '19892014']);
    expect(strip[1].querySelector('img')?.getAttribute('src')).toBe(SOUR_ART);
    expect(document.querySelector('.comparison-details')!.textContent).toContain('First 1 of 18 studio albums');
    expect(document.querySelector('.graph-node.is-primary img')?.getAttribute('src')).toBe(SOUR_ART);
  });

  it('loads the cover for a saved artist on About Me', async () => {
    localStorage.setItem('song-nexus-profile', JSON.stringify({ artists: [{ id: OLIVIA, name: 'Olivia Rodrigo', subtitle: 'Person' }], songs: [], albums: [], genres: [] }));
    await render('/about');
    expect(called(`/api/musicbrainz/details?type=artist&id=${OLIVIA}`)).toBe(true);
    expect(document.querySelector('.favorite-item img')?.getAttribute('src')).toBe(SOUR_ART);
  });

  it('writes the default pair into a bare /compare/artists link', async () => {
    await render('/compare/artists');
    expect(window.location.search).toBe(`?artistA=${OLIVIA}&artistB=${TAYLOR}`);
  });

  it('opens a song comparison from a collaborator’s tracks', async () => {
    await render('/compare/artists');
    await click(button('Compare “vampire” and “The Fate of Ophelia”'));
    expect(window.location.pathname).toBe('/compare/songs');
    expect(window.location.search).toBe(`?songA=${VAMPIRE}&songB=${OPHELIA}`);
    expect(text()).toContain('vampire → Olivia Rodrigo → Serban Ghenea → Taylor Swift → The Fate of Ophelia');
  });

  it('compares the two artists’ top songs', async () => {
    await render('/compare/artists');
    await click(button('Compare their top songs'));
    expect(called(`/api/top-track?id=${OLIVIA}&name=Olivia%20Rodrigo`)).toBe(true);
    expect(window.location.search).toBe(`?songA=${EXPECTATIONS}&songB=${PATIENT_ZERO}`);
    expect(document.querySelector('.selected-cards')!.textContent).toContain('Patient Zero');
  });

  it('filters collaborators by role and keeps the filter in the URL', async () => {
    await render('/compare/artists');
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Filter collaborators by role"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'producer');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(window.location.search).toContain('role=producer');
    const list = document.querySelector('.collab-list')!.textContent!;
    expect(list).toContain('Dan Nigro');
    expect(list).not.toContain('Serban Ghenea');
  });

  it('searches MusicBrainz from the picker and swaps an artist', async () => {
    await render('/compare/artists');
    await click(document.querySelectorAll('.chooser-button')[1]);
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Search artists"]')!, 'Phoebe');
    expect(called('/api/musicbrainz/search?type=artist&limit=10&q=Phoebe')).toBe(true);
    await click(button('Phoebe Bridgers'));
    expect(window.location.search).toBe(`?artistA=${OLIVIA}&artistB=${PHOEBE}`);
    expect(document.querySelector('.selected-cards')!.textContent).toContain('Phoebe Bridgers');
  });

  it('shows the API error and recovers on “Try again”', async () => {
    failures[`/api/musicbrainz/details:${TAYLOR}`] = 1;
    await render('/compare/artists');
    expect(text()).toContain('MusicBrainz is busy right now.');
    await click(buttons().find(b => b.textContent === 'Try again')!);
    expect(document.querySelector('.selected-cards')!.textContent).toContain('Taylor Swift');
  });

  it('goes back to the previous comparison with the browser’s back button', async () => {
    await render('/compare/artists');
    await click(button('Compare “vampire” and “The Fate of Ophelia”'));
    await act(async () => { window.history.back(); await new Promise(r => setTimeout(r, 30)); });
    await settle();
    expect(window.location.pathname).toBe('/compare/artists');
    expect(document.querySelector('.selected-cards')!.textContent).toContain('Taylor Swift');
  });
});

describe('details drawer and sharing', () => {
  it('shows an artist’s albums newest first and adds them to your taste', async () => {
    await render('/compare/artists');
    await click(document.querySelector('.selected-card')!);
    const drawer = document.querySelector('.detail-drawer')!;
    expect(drawer.textContent).toContain('Born');
    expect(drawer.textContent!.indexOf('GUTS')).toBeLessThan(drawer.textContent!.indexOf('SOUR'));
    await click(button('Add to your taste'));
    expect(stored().artists.map((a: { id: string }) => a.id)).toEqual([OLIVIA]);
    expect(button('In your taste')).toBeTruthy();
  });

  it('builds a share link for the current comparison with an optional note', async () => {
    await render('/compare/artists');
    await click(button('Share'));
    const link = document.querySelector<HTMLInputElement>('#share-url')!;
    expect(link.value).toBe(`http://localhost:3000/compare/artists?artistA=${OLIVIA}&artistB=${TAYLOR}`);
    expect(document.querySelector('.share-pair')!.textContent).toBe('Olivia Rodrigo ↔ Taylor Swift');
    await type(document.querySelector<HTMLTextAreaElement>('#share-note')!, 'same mixer!');
    expect(document.querySelector<HTMLInputElement>('#share-url')!.value).toContain('note=same+mixer%21');
  });
});

describe('About Me', () => {
  it('adds an artist from MusicBrainz search and keeps it after Done', async () => {
    await render('/about/manual');
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Search music"]')!, 'Phoebe');
    await click(document.querySelector('.catalog-card')!);
    expect(stored().artists[0]).toMatchObject({ id: PHOEBE, name: 'Phoebe Bridgers' });
    await click(button('Done'));
    expect(window.location.pathname).toBe('/about');
    expect(document.querySelector('.taste-grid')!.textContent).toContain('Phoebe Bridgers');
  });

  it('adds an album from an artist’s studio discography', async () => {
    await render('/about/manual');
    await click(button('Albums'));
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Search music"]')!, 'Phoebe');
    expect(text()).toContain('Studio albums by Phoebe Bridgers, newest first.');
    await click([...document.querySelectorAll('.catalog-card')].find(c => c.textContent?.includes('Punisher'))!);
    expect(stored().albums[0]).toMatchObject({ id: PUNISHER, artist: 'Phoebe Bridgers', year: '2020' });
  });

  it('shows a shared profile read-only without touching your own', async () => {
    localStorage.setItem('song-nexus-profile', JSON.stringify({ artists: [], songs: [], albums: [], genres: ['jazz'] }));
    const shared = { artists: [{ id: PHOEBE, name: 'Phoebe Bridgers', subtitle: 'Person · US' }], songs: [], albums: [], genres: ['indie folk'] };
    await render(`/about?profile=${encodeURIComponent(JSON.stringify(shared))}&note=my%20taste`);
    expect(text()).toContain('Shared About Me');
    expect(text()).toContain('my taste');
    expect(document.querySelector('.taste-grid')!.textContent).toContain('Phoebe Bridgers');
    expect(document.querySelector('.remove-preference')).toBeNull();
    expect(stored().genres).toEqual(['jazz']);
  });

  it('imports a playlist by matching each row on MusicBrainz', async () => {
    await render('/about');
    await click(button('Upload Playlist'));
    await click(button('Load Sample Playlist'));
    await settle(20);
    expect(document.querySelector('.upload-preview')!.textContent).toContain('2 unique matches');
    expect(called('q=recording%3A%22vampire%22%20AND%20artist%3A%22Olivia%20Rodrigo%22')).toBe(true);
    await click(button('Import 2 songs'));
    const profile = stored();
    expect(profile.songs.map((s: { title: string }) => s.title)).toEqual(['vampire', 'Kill Bill']);
    expect(profile.artists.map((a: { name: string }) => a.name)).toEqual(['Olivia Rodrigo', 'SZA']);
  });
});
