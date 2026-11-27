// Everything the App integration tests share: a fake API answering by URL, the app rendered into
// jsdom, and helpers that drive it like a user. Importing it registers its own setup and cleanup.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';
import type { SimilarWeb, Song, TasteMap } from '@/lib/types';
import {
  collab, EXPECTATIONS, expectationsDetails, killBill, OLIVIA, oliviaDetails, OPHELIA, opheliaDetails, PATIENT_ZERO,
  patientZeroDetails, PHOEBE, phoebe, phoebeDetails, soundOk, TAYLOR, taylorDetails, VAMPIRE, vampireDetails,
} from './fixtures';
import type { SoundResult } from '@/lib/sound';
import { similarWeb } from './fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const DETAILS: Record<string, unknown> = {
  [OLIVIA]: oliviaDetails, [TAYLOR]: taylorDetails, [PHOEBE]: phoebeDetails,
  [VAMPIRE]: vampireDetails, [OPHELIA]: opheliaDetails, [EXPECTATIONS]: expectationsDetails, [PATIENT_ZERO]: patientZeroDetails,
};
export const vampireSong: Song = { ...vampireDetails };
const defaultFetch = async (input: string) => {
  const url = new URL(input, 'http://localhost');
  const q = url.searchParams;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const key = `${url.pathname}:${q.get('id') ?? ''}`;
  if (world.failures[key]) { world.failures[key]--; return reply({ error: 'MusicBrainz is busy right now.', retryable: true }, 503); }
  switch (url.pathname) {
    case '/api/musicbrainz/details': return DETAILS[q.get('id')!] ? reply({ details: DETAILS[q.get('id')!] }) : reply({ error: 'Not found' }, 404);
    case '/api/musicbrainz/collaborators': return reply({ collaborators: collab });
    case '/api/similar': return reply({ similar: world.similar });
    case '/api/taste': return reply({ taste: tasteReply });
    case '/api/rooms': return reply(world.roomsUnavailable ? { error: 'Short codes aren’t set up on this server.', unavailable: true } : { code: 'ABC234' }, world.roomsUnavailable ? 503 : 200);
    case '/api/rooms/ABC234': return reply({ room: world.room });
    case '/api/rooms/NOPE22': return reply({ error: 'That code doesn’t match a room.' }, 404);
    case '/api/credits': return reply({ credits: moreCreditsReply });
    case '/api/artist-insights': return reply({ insights: insightsReply });
    case '/api/top-track': return reply({ track: q.get('id') === OLIVIA ? expectationsDetails : patientZeroDetails });
    case '/api/sound': return reply(world.sound);
    case '/api/sound/search': return reply(world.soundSearch);
    case '/api/musicbrainz/search': {
      const query = q.get('q') ?? '';
      if (q.get('type') === 'artist') return reply({ results: /phoebe/i.test(query) ? [phoebe] : [] });
      return reply({ results: /vampire/i.test(query) ? [vampireSong] : /Kill Bill/.test(query) ? [killBill, { ...killBill, id: EXPECTATIONS, title: 'Kill Bill (Live)' }] : [] });
    }
  }
  return reply({ error: 'unknown route' }, 404);
};
export const fetchMock = vi.fn(defaultFetch);
export const moreCreditsReply = {
  collaborators: [{ source: 'genius', id: '77', name: 'Only On Genius', url: 'https://genius.com/artists/Only-on-genius', roles: { a: ['songwriting'], b: ['producer'] }, count: { a: 2, b: 1 },
    evidence: { a: [{ title: 'Song One', url: 'https://genius.com/song-one', year: '2021' }], b: [{ title: 'Song Two', url: 'https://genius.com/song-two', year: '2020' }] } }],
  direct: [],
  sources: [{ source: 'Genius', status: 'ok', scanned: { a: 30, b: 30 }, unit: 'songs' }, { source: 'Discogs', status: 'no-match' }],
};
export const insightsReply = {
  a: { id: OLIVIA, facts: { wikidataUrl: 'https://www.wikidata.org/wiki/Q1', description: 'American singer', activeFrom: '2015', awards: [{ id: 'Q9', name: 'Grammy Award for Best New Artist', year: '2022' }], nominations: [], labels: [],
    wikipedia: { url: 'https://en.wikipedia.org/wiki/Olivia_Rodrigo', extract: 'Olivia Rodrigo is a singer.', imageUrl: null } }, audience: { listenBrainz: { listeners: 18915, listens: 1329454, url: 'https://listenbrainz.org/artist/x' }, lastFm: null } },
  b: { id: 'b', facts: null, audience: { listenBrainz: null, lastFm: null } },
  shared: {
    awards: [{ id: 'Q10', name: 'Billboard 21 Under 21', year: '' }, { id: 'Q11', name: 'Grammy Award for Best Pop Vocal Album', year: '' }],
    labels: [{ id: 'Q5', name: 'Republic Records', year: '' }], similarArtists: [],
  },
  sources: [{ source: 'Wikidata', status: 'no-match' }, { source: 'ListenBrainz', status: 'ok' }, { source: 'Last.fm', status: 'no-key' }],
};

let root: Root | null = null;
let App: typeof import('../App').default;
export const samplePlaylist = [{ title: 'vampire', artist: 'Olivia Rodrigo' }];
/** What the fake API answers; each test starts from these and may change them. */
export const world = {
  /** Requests by "path:id" that fail this many times first, as a busy MusicBrainz. */
  failures: {} as Record<string, number>,
  similar: similarWeb as SimilarWeb,
  roomsUnavailable: false,
  room: { host: { name: 'Priya', songs: samplePlaylist }, guest: null } as { host: { name: string; songs: typeof samplePlaylist }; guest: { name: string; songs: typeof samplePlaylist } | null },
  sound: soundOk as SoundResult,
  soundSearch: { status: 'unavailable' } as unknown,
};
export const tasteReply: TasteMap = {
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
  world.failures = {};
  world.similar = similarWeb;
  world.roomsUnavailable = false;
  world.room = { host: { name: 'Priya', songs: samplePlaylist }, guest: null };
  world.sound = soundOk;
  world.soundSearch = { status: 'unavailable' };
  fetchMock.mockReset();
  fetchMock.mockImplementation(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  window.scrollTo = vi.fn() as typeof window.scrollTo;
  localStorage.clear();
  // Most tests start as a returning visitor; the first-visit setup has its own tests below.
  localStorage.setItem('song-nexus-setup', JSON.stringify({ done: true, name: '', discover: null }));
  App = (await import('../App')).default;
  (await import('../api')).retryPolicy.delayMs = 0;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

export const settle = async (ms = 0) => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
export async function render(path: string) {
  window.history.replaceState(null, '', path);
  const container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  await settle();
}
export const text = () => document.body.textContent ?? '';
export const buttons = () => [...document.querySelectorAll('button')];
export const button = (label: string) => {
  const found = buttons().find(b => b.textContent?.includes(label) || b.getAttribute('aria-label') === label);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};
export const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await settle(); };
export async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(120); // past the 300 ms search debounce
}
export const called = (part: string) => fetchMock.mock.calls.some(([url]) => String(url).includes(part));
export const webPan = () => { const match = document.querySelector<HTMLElement>('.web-world')!.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)!; return { x: Number(match[1]), y: Number(match[2]) }; };
export const stored = () => JSON.parse(localStorage.getItem('song-nexus-profile') || 'null');

/** Closes the app as leaving the page would, keeping storage, so the next render() is a return visit. */
export const unmountApp = () => act(async () => root?.unmount());
