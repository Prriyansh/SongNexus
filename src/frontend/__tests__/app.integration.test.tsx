// @vitest-environment jsdom
// Renders the whole app (Helen's screens) against a mocked version of our API routes and drives it
// like a user: deep links, comparisons, collaborators, top songs, About Me, drawer, share, playlist.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtistDetails, Song } from '@/lib/types';
import {
  collab, SOUR_ART, EXPECTATIONS, expectationsDetails, killBill, OLIVIA, oliviaDetails, OPHELIA, opheliaDetails, PATIENT_ZERO,
  patientZeroDetails, PHOEBE, phoebe, phoebeDetails, PUNISHER, soundOk, TAYLOR, taylorDetails, VAMPIRE, vampireDetails,
} from './fixtures';
import type { SoundResult } from '@/lib/sound';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DETAILS: Record<string, unknown> = {
  [OLIVIA]: oliviaDetails, [TAYLOR]: taylorDetails, [PHOEBE]: phoebeDetails,
  [VAMPIRE]: vampireDetails, [OPHELIA]: opheliaDetails, [EXPECTATIONS]: expectationsDetails, [PATIENT_ZERO]: patientZeroDetails,
};
const vampireSong: Song = { ...vampireDetails };
let failures: Record<string, number> = {};
let soundReply: SoundResult = soundOk;
let soundSearchReply: unknown = { status: 'unavailable' };
const defaultFetch = async (input: string) => {
  const url = new URL(input, 'http://localhost');
  const q = url.searchParams;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const key = `${url.pathname}:${q.get('id') ?? ''}`;
  if (failures[key]) { failures[key]--; return reply({ error: 'MusicBrainz is busy right now.', retryable: true }, 503); }
  switch (url.pathname) {
    case '/api/musicbrainz/details': return DETAILS[q.get('id')!] ? reply({ details: DETAILS[q.get('id')!] }) : reply({ error: 'Not found' }, 404);
    case '/api/musicbrainz/collaborators': return reply({ collaborators: collab });
    case '/api/musicbrainz/neighborhood': {
      const id = q.get('id')!;
      const artist = (DETAILS[id] ?? { ...oliviaDetails, id }) as ArtistDetails;
      const seed = [...id].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 100000, 0) * 100;
      return reply({ neighborhood: { artist, failed: [], artists: Array.from({ length: 40 }, (_, i) => ({ ...phoebe,
        id: `dc000000-0000-4000-8000-${String(seed + i + 1).padStart(12, '0')}`, name: `Nearby musician ${i}`, tags: ['pop'],
        reasons: [{ kind: 'country', text: 'Also from US', sourceUrl: `https://musicbrainz.org/artist/${id}`, relatedTo: id }],
      })) } });
    }
    case '/api/top-track': return reply({ track: q.get('id') === OLIVIA ? expectationsDetails : patientZeroDetails });
    case '/api/sound': return reply(soundReply);
    case '/api/sound/search': return reply(soundSearchReply);
    case '/api/musicbrainz/search': {
      const query = q.get('q') ?? '';
      if (q.get('type') === 'artist') return reply({ results: /phoebe/i.test(query) ? [phoebe] : [] });
      return reply({ results: /vampire/i.test(query) ? [vampireSong] : /Kill Bill/.test(query) ? [killBill, { ...killBill, id: EXPECTATIONS, title: 'Kill Bill (Live)' }] : [] });
    }
  }
  return reply({ error: 'unknown route' }, 404);
};
const fetchMock = vi.fn(defaultFetch);

let root: Root | null = null;
let App: typeof import('../App').default;

beforeEach(async () => {
  vi.resetModules(); // fresh api memo per test
  failures = {};
  soundReply = soundOk;
  soundSearchReply = { status: 'unavailable' };
  fetchMock.mockReset();
  fetchMock.mockImplementation(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  localStorage.clear();
  App = (await import('../App')).default;
  (await import('../api')).retryPolicy.delayMs = 0;
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
const visibleWebArtists = () => [...document.querySelectorAll<HTMLElement>('.web-artist[data-in-viewport="true"]')];
const webPan = () => { const match = document.querySelector<HTMLElement>('.web-world')!.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)!; return { x: Number(match[1]), y: Number(match[2]) }; };
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

  it('retries a busy MusicBrainz once without showing an error', async () => {
    failures[`/api/musicbrainz/details:${TAYLOR}`] = 1;
    await render('/compare/artists');
    expect(text()).not.toContain('MusicBrainz is busy right now.');
    expect(document.querySelector('.selected-cards')!.textContent).toContain('Taylor Swift');
  });

  it('shows the API error and recovers on “Try again”', async () => {
    failures[`/api/musicbrainz/details:${TAYLOR}`] = 2; // the request and its automatic retry
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

describe('Connection Web workspace', () => {
  it('uses a viewport workspace only on Connection Web and keeps its lock after closing details', async () => {
    await render('/connections');
    expect(document.querySelector('.app-shell.is-connection-web')).not.toBeNull();
    expect(document.querySelector('main footer')).toBeNull();
    expect(document.querySelector('.web-page-heading p')).toBeNull();
    await click(button('View artist: Olivia Rodrigo'));
    await click(button('Close details'));
    expect(document.querySelector('.app-shell.is-connection-web')).not.toBeNull();
    await click(button('About Me'));
    expect(document.querySelector('.app-shell.is-connection-web')).toBeNull();
    expect(document.querySelector('main footer')).not.toBeNull();
    await click(button('Explore'));
    expect(document.querySelector('.app-shell.is-connection-web')).toBeNull();
    await click(button('Connection Web'));
    expect(document.querySelector('.app-shell.is-connection-web')).not.toBeNull();
    await click(document.querySelector('.web-mode button')!);
    expect(document.querySelector('.app-shell.is-connection-web')).not.toBeNull();
    expect(document.querySelector('main footer')).toBeNull();
  });

  it('pans freely and scrolls to zoom without losing the camera when discovery updates', async () => {
    await render('/connections');
    const canvas = document.querySelector<HTMLElement>('.web-map')!;
    const initial = webPan();
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 50, clientY: 50 }));
      canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 170, clientY: 105 }));
      canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 170, clientY: 105 }));
    });
    await settle();
    expect(webPan()).toEqual({ x: initial.x + 120, y: initial.y + 55 });
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, clientX: 90, clientY: 70 });
    await act(async () => { canvas.dispatchEvent(wheel); });
    expect(wheel.defaultPrevented).toBe(true);
    const scrolled = webPan();
    await settle(40);
    expect(document.querySelector('output[aria-label="Map zoom"]')?.textContent).not.toBe('100%');
    expect(webPan()).toEqual(scrolled);
    await act(async () => { canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(webPan().x).toBeCloseTo(scrolled.x - 40);
    await click(button('Fit connection map'));
    expect(webPan()).toEqual(initial);
  });

  it('shows a sparse varied overview and denser local detail without changing card size or adding a legend', async () => {
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: string) => {
      const query = new URL(input, 'http://localhost').searchParams.get('q') ?? '';
      const genre = query.match(/^tag:"([^"]+)"/)?.[1];
      return genre ? new Response(JSON.stringify({ results: Array.from({ length: 5 }, (_, i) => ({ ...phoebe, id: `discovery-${genre}-${i}`, name: `${genre} musician ${i}`, tags: [genre] })) })) : base(input);
    });
    await render('/connections');
    const initial = visibleWebArtists().map(n => n.getAttribute('aria-label'));
    const pairDistance = () => { const pair = [...document.querySelectorAll<HTMLElement>('.web-artist.anchor')]; return Math.hypot(parseFloat(pair[0].style.left) - parseFloat(pair[1].style.left), parseFloat(pair[0].style.top) - parseFloat(pair[1].style.top)); };
    const initialDistance = pairDistance();
    await click(button('Zoom in'));
    const close = visibleWebArtists().map(n => n.getAttribute('aria-label'));
    expect(close.length).toBeGreaterThan(initial.length);
    for (const name of initial) expect([...document.querySelectorAll('.web-artist')].map(n => n.getAttribute('aria-label'))).toContain(name);
    expect(document.querySelector('output[aria-label="Map zoom"]')?.textContent).toBe('135%');
    expect(pairDistance() / initialDistance).toBeCloseTo(1.35);
    expect(document.querySelector<HTMLElement>('.web-world')!.style.transform).not.toContain('scale');
    await click(button('Zoom out'));
    await click(button('Zoom out'));
    const wide = visibleWebArtists().map(n => n.getAttribute('aria-label'));
    expect(wide.some(name => !initial.includes(name))).toBe(true);
    expect(wide.length).toBeLessThan(close.length);
    expect(wide.length).toBeLessThanOrEqual(10); // Stable regional representatives plus the documented path.
    const widePositions = new Map([...document.querySelectorAll<HTMLElement>('.web-artist')].map(n => [n.dataset.artistId, `${n.dataset.worldX}:${n.dataset.worldY}`]));
    await click(button('Zoom in'));
    await click(button('Zoom in'));
    const restored = visibleWebArtists();
    expect(restored.length).toBeGreaterThan(wide.length);
    for (const node of restored) {
      const old = widePositions.get(node.dataset.artistId);
      if (old) expect(`${node.dataset.worldX}:${node.dataset.worldY}`).toBe(old);
    }
    expect(document.querySelector('.web-live-label small')?.textContent).toBe(`${restored.length} artists`);
    expect(document.querySelectorAll('.web-line')).toHaveLength(2);
    expect(document.querySelector('.web-legend')).toBeNull();
    expect(document.querySelector('.web-map-navigation')).toBeNull();
    expect(document.querySelector('.web-pan-hint')).toBeNull();
    expect(document.querySelector('.web-dock-label')).toBeNull();
    expect(text()).not.toContain('Musical neighborhood');
    expect(text()).not.toContain('Across genres');
    await click(document.querySelector('.web-mode button')!);
    expect(document.querySelector('.web-map-status')).toBeNull();
    expect(text()).not.toContain('Explore the song’s performers and their genre neighborhood.');
    fetchMock.mockImplementation(base);
  });

  it('expands the context artist nearest the scroll pointer and preserves every existing position', async () => {
    await render('/connections');
    await click(button('Zoom in'));
    const context = visibleWebArtists().find(n => n.getAttribute('aria-label')?.startsWith('View artist: Nearby musician'))!;
    const canvas = document.querySelector<HTMLElement>('.web-map')!;
    const before = new Map([...document.querySelectorAll<HTMLElement>('.web-artist')].map(n => [n.dataset.artistId, `${n.dataset.worldX}:${n.dataset.worldY}`]));
    const pan = webPan();
    await act(async () => { canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120,
      clientX: parseFloat(context.style.left) + pan.x, clientY: parseFloat(context.style.top) - (context.classList.contains('anchor') ? 22 : 25) + pan.y })); });
    await settle(40);
    expect(called(`/api/musicbrainz/neighborhood?id=${context.dataset.artistId}`)).toBe(true);
    for (const node of document.querySelectorAll<HTMLElement>('.web-artist')) {
      const old = before.get(node.dataset.artistId);
      if (old) expect(`${node.dataset.worldX}:${node.dataset.worldY}`).toBe(old);
    }
    expect(document.querySelectorAll('.web-artist').length).toBeGreaterThan(before.size);
    expect(document.querySelector('.web-legend')).toBeNull();
  });

  it('opens from navigation, shows the selected pair, and opens artist details immediately', async () => {
    await render('/about');
    await click(button('Connection Web'));
    expect(window.location.pathname).toBe('/connections');
    expect(button('Connection Web').getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('.web-map-heading')?.textContent).toContain('Olivia Rodrigo');
    await click(button('View artist: Olivia Rodrigo'));
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Artist details');
    expect(document.querySelector('.detail-drawer')?.textContent).toContain('Born');
    expect(document.querySelector('.detail-drawer')?.textContent).toContain('GUTS');
  });

  it('switches to one-song search and preserves each mode’s choices across navigation', async () => {
    await render(`/connections?artistA=${PHOEBE}&artistB=${TAYLOR}`);
    await click(document.querySelector('.web-mode button')!);
    expect(window.location.search).toContain('mode=search');
    expect(document.querySelectorAll('.web-selection-dock .chooser')).toHaveLength(1);
    expect(document.querySelector('.web-map-heading')?.textContent).toContain('vampire');
    expect(button('View artist: Olivia Rodrigo')).toBeTruthy();
    await click(button('About Me'));
    await click(button('Connection Web'));
    expect(window.location.search).toContain('mode=search');
    await click(document.querySelectorAll('.web-mode button')[1]);
    expect(document.querySelector('.web-map-heading')?.textContent).toContain('Phoebe Bridgers');
    expect(document.querySelectorAll('.web-selection-dock .chooser')).toHaveLength(2);
  });

  it('searches for a replacement artist, swaps the pair, and shares the current web', async () => {
    await render('/connections');
    await click(document.querySelector('.web-selection-dock .chooser-button')!);
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Search artists"]')!, 'Phoebe');
    await click(document.querySelector('.chooser-option')!);
    expect(window.location.search).toContain(`artistA=${PHOEBE}`);
    await click(button('Swap artists'));
    expect(window.location.search).toContain(`artistA=${TAYLOR}`);
    expect(window.location.search).toContain(`artistB=${PHOEBE}`);
    await click(button('Share'));
    const url = new URL(document.querySelector<HTMLInputElement>('#share-url')!.value);
    expect(url.pathname).toBe('/connections');
    expect(url.searchParams.get('artistB')).toBe(PHOEBE);
  });

  it('zooms and fits the map, and restores the mode using browser back', async () => {
    await render('/connections');
    const initial = document.querySelector('output[aria-label="Map zoom"]')!.textContent;
    await click(button('Zoom in'));
    expect(document.querySelector('output[aria-label="Map zoom"]')!.textContent).not.toBe(initial);
    await click(button('Fit connection map'));
    expect(document.querySelector('output[aria-label="Map zoom"]')!.textContent).toBe(initial);
    await click(document.querySelector('.web-mode button')!);
    await act(async () => { window.history.back(); await new Promise(r => setTimeout(r, 30)); });
    await settle();
    expect(document.querySelectorAll('.web-mode button')[1].getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.web-map-heading')?.textContent).toContain('Taylor Swift');
  });

  it('keeps the map usable when discovery fails, and retries the failed lookup', async () => {
    failures['/api/musicbrainz/search:'] = 2;
    await render('/connections');
    expect(document.querySelector('.web-map-status')?.textContent).toContain('couldn’t be loaded');
    expect(button('View artist: Olivia Rodrigo')).toBeTruthy();
    await click(button('Try again'));
    expect(document.querySelector('.web-map-status')?.textContent).toContain('Credit path');
  });
});

describe('About Me', () => {
  it('keeps the search text across all categories and searches the active category', async () => {
    await render('/about/manual');
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search music"]')!;
    await type(input, '  Phoebe  ');

    await click(button('Albums'));
    expect(input.value).toBe('  Phoebe  ');
    await settle(60);
    expect(called('/api/musicbrainz/search?type=artist&limit=5&q=Phoebe')).toBe(true);
    expect(document.querySelector('.manual-grid')!.textContent).toContain('Punisher');

    await click(button('Songs'));
    expect(input.value).toBe('  Phoebe  ');
    await settle(60);
    expect(called('/api/musicbrainz/search?type=recording&limit=24&q=Phoebe')).toBe(true);
    expect(document.querySelector('.catalog-empty')!.textContent).toContain('No matches');

    const searches = fetchMock.mock.calls.length;
    await click(button('Genres'));
    expect(input.value).toBe('  Phoebe  ');
    await settle(60);
    expect(fetchMock.mock.calls.length).toBe(searches);
    expect(document.querySelector('.catalog-card')).toBeNull();

    await click(button('Artists'));
    expect(input.value).toBe('  Phoebe  ');
    await settle(60);
    expect(document.querySelector('.manual-grid')!.textContent).toContain('Phoebe Bridgers');

    await click(button('Clear search'));
    await click(button('Songs'));
    expect(input.value).toBe('');
    await type(input, 'vampire');
    expect(document.querySelector('.manual-grid')!.textContent).toContain('vampire');
    await click(button('Artists'));
    expect(input.value).toBe('vampire');
    await settle(60);
    expect(called('/api/musicbrainz/search?type=artist&limit=24&q=vampire')).toBe(true);
    expect(document.querySelector('.catalog-empty')!.textContent).toContain('No matches');
  });

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

describe('Explore: songs, sound and lyrics', () => {
  const songs = `/compare/songs?songA=${VAMPIRE}&songB=${OPHELIA}`;

  it('keeps song comparisons under Explore alongside the separate Connection Web destination', async () => {
    await render(songs);
    expect(document.querySelector('.song-analysis')).not.toBeNull();
    expect(button('2 Songs').getAttribute('aria-pressed')).toBe('true');
    expect(button('Explore').getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('.topbar-left > strong')?.textContent).toBe('Explore');
    expect(Array.from(document.querySelectorAll('nav[aria-label="Main navigation"] .nav-option'), item => item.textContent)).toEqual(['About Me', 'Connection Web', 'Explore']);

    await click(button('About Me'));
    expect(window.location.pathname).toBe('/about');
    await click(button('Explore'));
    expect(window.location.pathname + window.location.search).toBe(songs);
    expect(button('2 Songs').getAttribute('aria-pressed')).toBe('true');
    await click(button('2 Artists'));
    expect(window.location.pathname).toBe('/compare/artists');
    expect(button('Explore').getAttribute('aria-current')).toBe('page');
  });

  it('leads with the sound and lyrics analysis; MusicBrainz details come after it', async () => {
    await render(songs);
    expect(called('/api/sound?aTitle=vampire&aArtist=Olivia+Rodrigo&bTitle=The+Fate+of+Ophelia&bArtist=Taylor+Swift')).toBe(true);
    const analysis = document.querySelector('.song-analysis')!;
    const release = document.querySelector('.comparison-details:not(.structure-panel)')!;
    expect(analysis.compareDocumentPosition(release) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(release.textContent).toContain('07 / MORE ABOUT THESE SONGS');
    expect(release.textContent).toContain('Released');
    expect(document.querySelector('.selection-panel')!.textContent).toContain('Search the song library for the full sound and lyrics analysis');
  });

  it('shows how alike the songs are, with the reasons and what they share', async () => {
    await render(songs);
    const match = document.querySelector('.match-panel')!.textContent!;
    expect(match).toContain('71%overall match');
    expect(match).toContain('Sound74%');
    expect(match).toContain('Lyrics66%');
    expect(match).toContain('Keys are compatible (closely related key).');
    expect(match).toContain('Genre: Pop');
  });

  it('shows the sound profile, structure and lyrics side by side', async () => {
    await render(songs);
    const text = document.querySelector('.song-analysis')!.textContent!;
    expect(text).toContain('Energy43 / 68');
    expect(text).toContain('Tempo138 BPM128 BPM');
    expect(text).toContain('KeyA# majorF major');
    expect(text).toContain('Time signature4/4Unknown');
    expect(text).toContain('Verses / choruses / bridges2 / 3 / 12 / 3 / 1');
    expect(text).toContain('Keys: closely related key.');
    expect(text).toContain('Negative (-0.30)');
    expect(text).toContain('Themes90%');
    expect(text).toContain('Songs that sound like these');
  });

  it('says plainly when a song is not in the song library, and keeps the rest', async () => {
    soundReply = { status: 'not-found', missing: ['b'] };
    await render(songs);
    expect(document.querySelector('.match-panel')!.textContent).toContain('“The Fate of Ophelia” isn’t in the song library (Spotify tracks up to 2022)');
    expect(document.querySelector('.song-analysis')).toBeNull();
    expect(document.querySelector('.comparison-details')!.textContent).toContain('Released');
  });

  it('explains how to start the sound service when it is not running', async () => {
    soundReply = { status: 'unavailable', hint: 'Start it with: cd song_compare && python backend/app.py' };
    await render(songs);
    expect(document.querySelector('.match-panel')!.textContent).toContain('isn’t available right now. Start it with: cd song_compare && python backend/app.py');
  });

  it('compares the first song with a similar-sounding one found on MusicBrainz', async () => {
    await render(songs);
    await click(button('Kill Bill'));
    expect(called('q=recording%3A%22Kill%20Bill%22%20AND%20artist%3A%22SZA%22%20AND%20status%3Aofficial')).toBe(true);
    expect(window.location.search).toBe(`?songA=${VAMPIRE}&songB=${killBill.id}`);
  });

  it('picks the earliest-released MusicBrainz version of a similar song', async () => {
    const later = { ...killBill, id: PATIENT_ZERO, releases: [{ id: 'cc000000-0000-4000-8000-00000000000b', title: 'Kill Bill (Live)', date: '2024-01-01' }] };
    const original = { ...killBill, id: EXPECTATIONS, releases: [{ id: 'cc000000-0000-4000-8000-00000000000c', title: 'SOS', date: '2022-12-09' }] };
    await render(songs);
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: string) => input.includes('Kill%20Bill') ? new Response(JSON.stringify({ results: [later, original] })) : base(input));
    await click(button('Kill Bill'));
    expect(window.location.search).toBe(`?songA=${VAMPIRE}&songB=${EXPECTATIONS}`);
    fetchMock.mockImplementation(base);
  });

  it('does not ask for sound data in artist comparisons', async () => {
    await render('/compare/artists');
    expect(called('/api/sound')).toBe(false);
  });
});

describe('Explore: song pickers', () => {
  const openSongPicker = async (term: string, picker = 1) => {
    await render(`/compare/songs?songA=${VAMPIRE}&songB=${OPHELIA}`);
    await click(document.querySelectorAll('.chooser-button')[picker]);
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Search songs"]')!, term);
  };

  it('offers songs from the sound dataset and opens the MusicBrainz version of the pick', async () => {
    soundSearchReply = { status: 'ok', results: [{ id: 'sp-kb', title: 'Kill Bill', artists: ['SZA'], album: 'SOS', genre: 'r-n-b', has_lyrics: true }] };
    await openSongPicker('kill bill');
    expect(called('/api/sound/search?q=kill%20bill&limit=10')).toBe(true);
    expect(text()).toContain('Songs with full sound and lyrics analysis');
    await click(button('Kill Bill'));
    expect(called('q=recording%3A%22Kill%20Bill%22%20AND%20artist%3A%22SZA%22%20AND%20status%3Aofficial')).toBe(true);
    expect(window.location.search).toBe(`?songA=${VAMPIRE}&songB=${killBill.id}`);
  });

  it('says so when a dataset song cannot be found on MusicBrainz', async () => {
    soundSearchReply = { status: 'ok', results: [{ id: 'sp-x', title: 'Obscure Song', artists: ['Nobody'], album: null, genre: null, has_lyrics: false }] };
    await openSongPicker('obscure');
    await click(button('Obscure Song'));
    expect(text()).toContain('Couldn’t find “Obscure Song” on MusicBrainz.');
    expect(window.location.search).toBe(`?songA=${VAMPIRE}&songB=${OPHELIA}`);
  });

  it('falls back to MusicBrainz search when the sound service is not running', async () => {
    await openSongPicker('vampire', 0); // the first picker; the second hides the song already chosen
    expect(called('/api/musicbrainz/search?type=recording&limit=10&q=vampire')).toBe(true);
    expect(document.querySelector('.chooser-results')!.textContent).toContain('vampire');
    expect(text()).toContain('From MusicBrainz. Sound and lyrics analysis isn’t available right now.');
  });
});

