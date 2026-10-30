// @vitest-environment jsdom
// Renders the whole app (Helen's screens) against a mocked version of our API routes and drives it
// like a user: deep links, comparisons, collaborators, top songs, About Me, drawer, share, playlist.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimilarWeb, Song, TasteMap } from '@/lib/types';
import {
  collab, SOUR_ART, EXPECTATIONS, expectationsDetails, killBill, OLIVIA, oliviaDetails, OPHELIA, opheliaDetails, PATIENT_ZERO,
  patientZeroDetails, PHOEBE, phoebe, phoebeDetails, PUNISHER, soundOk, TAYLOR, taylorDetails, VAMPIRE, vampireDetails,
} from './fixtures';
import type { SoundResult } from '@/lib/sound';
import { similarWeb } from './fixtures';
import { examples } from '../routing';

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
    case '/api/similar': return reply({ similar: similarReply });
    case '/api/taste': return reply({ taste: tasteReply });
    case '/api/rooms': return reply(roomsUnavailable ? { error: 'Short codes aren’t set up on this server.', unavailable: true } : { code: 'ABC234' }, roomsUnavailable ? 503 : 200);
    case '/api/rooms/ABC234': return reply({ room: roomReply });
    case '/api/rooms/NOPE22': return reply({ error: 'That code doesn’t match a room.' }, 404);
    case '/api/credits': return reply({ credits: moreCreditsReply });
    case '/api/artist-insights': return reply({ insights: insightsReply });
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
const moreCreditsReply = {
  collaborators: [{ source: 'genius', id: '77', name: 'Only On Genius', url: 'https://genius.com/artists/Only-on-genius', roles: { a: ['songwriting'], b: ['producer'] }, count: { a: 2, b: 1 },
    evidence: { a: [{ title: 'Song One', url: 'https://genius.com/song-one', year: '2021' }], b: [{ title: 'Song Two', url: 'https://genius.com/song-two', year: '2020' }] } }],
  direct: [],
  sources: [{ source: 'Genius', status: 'ok', scanned: { a: 30, b: 30 }, unit: 'songs' }, { source: 'Discogs', status: 'no-match' }],
};
const insightsReply = {
  a: { id: OLIVIA, facts: { wikidataUrl: 'https://www.wikidata.org/wiki/Q1', description: 'American singer', activeFrom: '2015', awards: [{ id: 'Q9', name: 'Grammy Award for Best New Artist', year: '2022' }], nominations: [], labels: [],
    wikipedia: { url: 'https://en.wikipedia.org/wiki/Olivia_Rodrigo', extract: 'Olivia Rodrigo is a singer.', imageUrl: null } }, audience: { listenBrainz: { listeners: 18915, listens: 1329454, url: 'https://listenbrainz.org/artist/x' }, lastFm: null } },
  b: { id: 'b', facts: null, audience: { listenBrainz: null, lastFm: null } },
  shared: { awards: [], labels: [{ id: 'Q5', name: 'Republic Records', year: '' }], similarArtists: [] },
  sources: [{ source: 'Wikidata', status: 'no-match' }, { source: 'ListenBrainz', status: 'ok' }, { source: 'Last.fm', status: 'no-key' }],
};

let root: Root | null = null;
let App: typeof import('../App').default;
let similarReply: SimilarWeb = similarWeb;
let roomsUnavailable = false;
const samplePlaylist = [{ title: 'vampire', artist: 'Olivia Rodrigo' }];
let roomReply: { host: { name: string; songs: typeof samplePlaylist }; guest: { name: string; songs: typeof samplePlaylist } | null } = { host: { name: 'Priya', songs: samplePlaylist }, guest: null };
const tasteReply: TasteMap = {
  nodes: [
    { kind: 'artist', id: 'artist:sza', name: 'SZA', subtitle: '', mbid: PHOEBE, imageUrl: null, group: 'shared', weight: 4, reasons: [{ kind: 'listeners', text: 'On both playlists: 2 songs of yours and 2 songs of Priya’s.' }] },
    { kind: 'artist', id: 'artist:k', name: 'Kendrick Lamar', subtitle: '', mbid: TAYLOR, imageUrl: null, group: 'for-me', weight: 2, reasons: [{ kind: 'listeners', text: 'You might like this: people who play SZA, on your playlist, often play Kendrick Lamar too.' }] },
    { kind: 'song', id: 'song:kb', name: 'Kill Bill', subtitle: 'SZA', artist: 'SZA', mbid: null, imageUrl: null, group: 'shared', weight: 1, reasons: [{ kind: 'listeners', text: 'On both of your playlists.' }] },
  ],
  links: [{ from: 'artist:sza', to: 'song:kb', kind: 'contains' }, { from: 'artist:sza', to: 'artist:k', kind: 'similar' }],
  stats: { mineSongs: 2, mineArtists: 1, friendSongs: 3, friendArtists: 2, sharedArtists: 1, sharedSongs: 1, similarLinks: 1 },
  sources: [{ source: 'ListenBrainz', status: 'ok' }],
};

beforeEach(async () => {
  vi.resetModules(); // fresh api memo per test
  failures = {};
  similarReply = similarWeb;
  roomsUnavailable = false;
  roomReply = { host: { name: 'Priya', songs: samplePlaylist }, guest: null };
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
    expect(text()).toContain('Scanned all 3 of Olivia Rodrigo’s studio albums and Taylor Swift’s 3 most recent of 18 studio albums.');
    const nodes = [...document.querySelectorAll('.graph-node')].map(n => n.getAttribute('aria-label'));
    expect(nodes.some(label => label?.startsWith('Serban Ghenea'))).toBe(true);
    expect(text()).toContain('Neither is credited on the other’s scanned albums.');
  });

  it('adds facts and credits from other sources, each with its link, and says what was checked', async () => {
    await render(`/compare/artists?artistA=${OLIVIA}&artistB=${TAYLOR}`);
    await settle();
    const facts = document.querySelector('.artist-insights')!;
    expect(facts.textContent).toContain('Olivia Rodrigo is a singer.');
    expect(facts.textContent).toContain('Grammy Award for Best New Artist (2022)');
    expect(facts.textContent).toContain('18,915 listeners');
    expect(facts.textContent).toContain('Republic Records');
    expect(facts.textContent).toContain('Last.fm isn’t set up here.');
    const details = document.querySelector('.comparison-details')!;
    expect(details.textContent).toContain('Only On Genius');
    expect(details.textContent).toContain('Genius: checked 30 and 30 songs.');
    expect(details.querySelector('a[href="https://genius.com/song-one"]')).not.toBeNull();
    expect(details.textContent).toContain('Discogs: couldn’t confirm both artists there.');
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
  const card = () => document.querySelector('.web-info-card');

  it('uses a viewport workspace only on Connection Web, and opens on one artist with similar music around it', async () => {
    await render('/connections');
    expect(document.querySelector('.app-shell.is-connection-web')).not.toBeNull();
    expect(document.querySelector('main footer')).toBeNull();
    expect(button('Selected: Olivia Rodrigo')).toBeDefined();
    expect(button('Why is this here: Taylor Swift')).toBeDefined();
    expect(button('Why is this here: The Fate of Ophelia')).toBeDefined();
    expect(called(`/api/similar?kind=artist&id=${OLIVIA}`)).toBe(true);
    expect(document.querySelector('.web-summary')?.textContent).toContain('2 artists');
    expect(document.querySelector('.web-summary')?.textContent).toContain('1 songs');
    await click(button('About Me'));
    expect(document.querySelector('.app-shell.is-connection-web')).toBeNull();
    expect(document.querySelector('main footer')).not.toBeNull();
  });

  it('has one search, with no second artist to pick', async () => {
    await render('/connections');
    expect(document.querySelectorAll('.web-selection-dock .chooser')).toHaveLength(1);
    expect(buttons().some(b => b.getAttribute('aria-label') === 'Swap artists')).toBe(false);
    expect(buttons().some(b => b.textContent?.includes('Comparison'))).toBe(false);
  });

  it('explains why something is here, with its closeness and sources', async () => {
    await render('/connections');
    await click(button('Why is this here: Taylor Swift'));
    expect(card()?.textContent).toContain('97% of the closest match');
    expect(card()?.textContent).toContain('often play Taylor Swift in the same listening sessions');
    expect(card()?.textContent).toContain('Both tagged pop');
    expect(card()?.textContent).toContain('1,200 listeners on ListenBrainz');
    expect(card()?.textContent).toContain('Also connected to');
    expect(card()?.querySelector('a[href*="listenbrainz.org/artist"]')).not.toBeNull();
    await click(button('Close explanation'));
    expect(card()).toBeNull();
  });

  it('re-centers the map from anything on it', async () => {
    await render('/connections');
    await click(button('Why is this here: Taylor Swift'));
    await click(button('Explore from here'));
    expect(new URL(window.location.href).searchParams.get('artist')).toBe(TAYLOR);
    expect(called(`/api/similar?kind=artist&id=${TAYLOR}`)).toBe(true);
  });

  it('moves to song mode when exploring from a song', async () => {
    await render('/connections');
    await click(button('Why is this here: The Fate of Ophelia'));
    expect(buttons().some(b => b.textContent?.includes('Compare'))).toBe(false); // An artist and a song can't be compared.
    await click(button('Explore from here'));
    const params = new URL(window.location.href).searchParams;
    expect(params.get('mode')).toBe('song');
    expect(params.get('song')).toBe(OPHELIA);
  });

  it('sends a comparison of two artists over to Explore', async () => {
    await render('/connections');
    await click(button('Why is this here: Taylor Swift'));
    await click(button('Compare'));
    expect(window.location.pathname).toBe('/compare/artists');
    const params = new URL(window.location.href).searchParams;
    expect([params.get('artistA'), params.get('artistB')]).toEqual([OLIVIA, TAYLOR]);
  });

  it('opens details from the explanation card', async () => {
    await render('/connections');
    await click(button('Why is this here: Taylor Swift'));
    await click(button('Details'));
    expect(document.querySelector('.detail-drawer')).not.toBeNull();
  });

  it('filters to artists or songs without losing the map', async () => {
    await render('/connections');
    await click(document.querySelector('.web-filter button:nth-child(3)')!);
    expect(buttons().some(b => b.getAttribute('aria-label') === 'Why is this here: Taylor Swift')).toBe(false);
    expect(button('Why is this here: The Fate of Ophelia')).toBeDefined();
    expect(button('Selected: Olivia Rodrigo')).toBeDefined();
  });

  it('switches between artist and song, keeps each choice, and restores with browser back', async () => {
    await render('/connections');
    await click(button('Song'));
    expect(called(`/api/similar?kind=song&id=${examples.song[0]}`)).toBe(true);
    expect(new URL(window.location.href).searchParams.get('mode')).toBe('song');
    await act(async () => { window.history.back(); await new Promise(r => setTimeout(r, 30)); });
    await settle();
    expect(new URL(window.location.href).searchParams.get('mode')).toBe('artist');
  });

  it('pans and zooms the map without moving the page', async () => {
    await render('/connections');
    const map = document.querySelector<HTMLElement>('.web-map')!;
    const initial = webPan();
    await act(async () => {
      map.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 50, clientY: 50 }));
      map.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 170, clientY: 105 }));
      map.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 170, clientY: 105 }));
    });
    await settle();
    expect(webPan()).toEqual({ x: initial.x + 120, y: initial.y + 55 });
    await click(button('Zoom in'));
    expect(document.querySelector('output[aria-label="Map zoom"]')?.textContent).toBe('135%');
  });

  it('says what wasn’t available, shows a retry on failure, and recovers', async () => {
    failures[`/api/similar:${OLIVIA}`] = 2;
    await render('/connections');
    await settle(5);
    expect(document.querySelector('[role=alert]')?.textContent).toContain('couldn’t load this map');
    await click(button('Try again'));
    expect(button('Selected: Olivia Rodrigo')).toBeDefined();
  });

  it('says so when the listening data has nothing for this one', async () => {
    similarReply = { ...similarWeb, artists: [], songs: [], links: [] };
    await render('/connections');
    expect(document.querySelector('.web-map-note')?.textContent).toContain('Nothing to compare yet');
  });

  it('shares the current web', async () => {
    await render('/connections');
    await click(button('Share'));
    const value = document.querySelector<HTMLInputElement>('#share-url')!.value;
    expect(value).toContain('/connections?mode=artist');
    expect(value).toContain(`artist=${OLIVIA}`);
  });
});

describe('Connection Web: my playlist', () => {
  it('builds a map from pasted songs, keeps it for next time, and can start again', async () => {
    await render('/connections?mode=playlist');
    expect(document.querySelector('.taste-box h3')?.textContent).toContain('Build a web from your playlist');
    await type(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste a playlist"]')!, 'vampire - Olivia Rodrigo\nKill Bill - SZA');
    await click(button('Use pasted songs'));
    await settle();
    const body = JSON.parse(String((fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url === '/api/taste')![1].body));
    expect(body).toEqual({ mine: [{ title: 'vampire', artist: 'Olivia Rodrigo' }, { title: 'Kill Bill', artist: 'SZA' }] });
    expect(button('Why is this here: SZA')).toBeDefined();
    expect(localStorage.getItem('song-nexus-playlist')).toContain('vampire');
    await click(button('Change playlist'));
    expect(localStorage.getItem('song-nexus-playlist')).toBeNull();
  });

  it('says what to do when songs have no artists', async () => {
    await render('/connections?mode=playlist');
    await type(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste a playlist"]')!, 'just a title');
    await click(button('Use pasted songs'));
    expect(document.querySelector('[role=alert]')?.textContent).toContain('no artist names');
  });

  it('isn’t where friends are compared', async () => {
    await render('/connections');
    expect(buttons().some(b => b.textContent?.includes('With a friend'))).toBe(false);
    expect(button('My playlist')).toBeDefined();
  });
});

describe('Friends', () => {
  const useSample = async () => { await click(button('Try a sample')); await settle(); };

  it('is its own page in the sidebar', async () => {
    await render('/connections');
    await click(button('Friends'));
    expect(window.location.pathname).toBe('/friends');
    expect(document.querySelector('.web-page-heading h1')?.textContent).toBe('Friends');
  });

  it('gives you a short code and opens the map by itself once your friend joins', async () => {
    await render('/friends');
    await useSample();
    await click(button('Get a code to share'));
    await settle();
    expect(document.querySelector('.room-code')?.textContent).toBe('ABC234');
    expect(document.querySelector('.room-waiting')?.textContent).toContain('Waiting for your friend');
    roomReply = { ...roomReply, guest: { name: 'Sam', songs: samplePlaylist } };
    await act(async () => { await new Promise(r => setTimeout(r, 4100)); });
    await settle();
    expect(button('Why is this here: SZA')).toBeDefined();
    expect(document.querySelector('.web-live-label')?.textContent).toContain('YOU AND SAM');
    expect(document.querySelector('.taste-legend')?.textContent).toContain('You should listen');
  }, 10000);

  it('remembers your room when you come back', async () => {
    localStorage.setItem('song-nexus-room', JSON.stringify({ code: 'ABC234', role: 'host' }));
    await render('/friends');
    expect(document.querySelector('.room-code')?.textContent).toBe('ABC234');
  });

  it('lets a friend join from a link, then upload, and shows it from their side', async () => {
    await render('/friends?code=ABC234');
    await settle();
    expect(document.querySelector('.taste-box h3')?.textContent).toBe('Priya wants to compare playlists');
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ room: { host: roomReply.host, guest: { name: '', songs: [{ title: 'Kill Bill', artist: 'SZA' }] } } })));
    await useSample();
    const body = JSON.parse(String((fetchMock.mock.calls as unknown as [string, RequestInit?][]).find(([, init]) => init?.method === 'POST')![1]!.body));
    expect(body.songs.length).toBeGreaterThan(0);
    await settle();
    expect(document.querySelector('.web-live-label')?.textContent).toContain('YOU AND PRIYA');
  });

  it('lets a friend type the code in', async () => {
    await render('/friends');
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Room code"]')!, 'abc234');
    await click(button('Continue'));
    await settle();
    expect(document.querySelector('.taste-box h3')?.textContent).toBe('Priya wants to compare playlists');
  });

  it('says so when a code is wrong', async () => {
    await render('/friends');
    await type(document.querySelector<HTMLInputElement>('input[aria-label="Room code"]')!, 'nope22');
    await click(button('Continue'));
    await settle();
    expect(document.querySelector('[role=alert]')?.textContent).toContain('doesn’t match a room');
  });

  it('falls back to a long link where short codes aren’t set up', async () => {
    roomsUnavailable = true;
    await render('/friends');
    await useSample();
    await click(button('Get a code to share'));
    await settle(5);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Your friend link"]')?.value).toContain('/friends#a=');
  });

  it('opens a long link as an invitation, with the playlist kept out of the server request', async () => {
    const { encodePlaylist, friendLink } = await import('../taste');
    const code = await encodePlaylist({ name: 'Priya', songs: samplePlaylist });
    await render(new URL(friendLink('http://localhost', code)).pathname + new URL(friendLink('http://localhost', code)).hash);
    await settle(5);
    expect(document.querySelector('.taste-box h3')?.textContent).toBe('Priya wants to compare playlists');
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
    expect(Array.from(document.querySelectorAll('nav[aria-label="Main navigation"] .nav-option'), item => item.textContent)).toEqual(['About Me', 'Connection Web', 'Friends', 'Explore']);

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

