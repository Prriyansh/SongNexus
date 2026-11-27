// @vitest-environment jsdom
// The Friends page on its own, with the playlist codec and the API replaced so answers arrive
// exactly when a test says: a link decoded after the page has gone, a link back built for an old
// pair of playlists, and the page's smaller controls.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedPlaylist } from '../taste';

const codec = vi.hoisted(() => ({ decode: vi.fn(), encode: vi.fn() }));
vi.mock('../taste', async (original) => {
  const actual = await original<typeof import('../taste')>();
  return { ...actual, decodePlaylist: codec.decode, encodePlaylist: codec.encode };
});
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>();
  return { ...actual, tasteWeb: vi.fn(() => new Promise(() => {})), readRoom: vi.fn(() => new Promise(() => {})), createRoom: vi.fn() };
});
import { Friends } from '../components/TasteWeb';
import { emptyProfile } from '../profile';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); localStorage.clear(); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.innerHTML = ''; window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const mine: SharedPlaylist = { name: 'Me', songs: [{ title: 'vampire', artist: 'Olivia Rodrigo' }] };
const theirs: SharedPlaylist = { name: 'Sam', songs: [{ title: 'Kill Bill', artist: 'SZA' }] };
function later<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
async function show(path = '/friends') {
  window.history.replaceState(null, '', path);
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root!.render(<Friends profile={emptyProfile} onExploreArtist={vi.fn()} onExploreSong={vi.fn()} onDetails={vi.fn()} />));
}
const words = () => document.body.textContent ?? '';
const named = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(name))!;
const press = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('answers that arrive too late', () => {
  it('does nothing with a link decoded after the page has gone', async () => {
    const slow = later<SharedPlaylist | null>();
    codec.decode.mockReturnValueOnce(slow.promise);
    await show('/friends#a=abc');
    await act(async () => root!.unmount());
    root = null;
    await act(async () => { slow.resolve(mine); });
    expect(codec.encode).not.toHaveBeenCalled();
  });

  it('drops a link back built for playlists that are no longer shown', async () => {
    codec.decode.mockResolvedValueOnce(theirs).mockResolvedValueOnce(mine);
    const slow = later<string>();
    codec.encode.mockReturnValueOnce(slow.promise).mockResolvedValue('code');
    await show('/friends#a=x&b=y');
    await act(async () => { await Promise.resolve(); });
    expect(words()).toContain('YOU AND ME'); // the link's first playlist is yours
    await press(named('Start over'));
    await act(async () => { slow.resolve('stale'); });
    expect(document.querySelector('[aria-label="Copy link for your friend"]')).toBeNull();
    expect(words()).not.toContain('Copy link for your friend');
  });
});

describe('the page’s smaller controls', () => {
  it('keeps the name you type, and lets you swap the playlist you had', async () => {
    localStorage.setItem('song-nexus-playlist', JSON.stringify(mine));
    await show();
    const name = document.querySelector<HTMLInputElement>('#taste-name')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Alka');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(name.value).toBe('Alka');
    expect(words()).toContain('1 songs ready.');
    await press(named('Use a different playlist'));
    expect(document.querySelector('textarea[aria-label="Paste a playlist"]')).not.toBeNull();
    expect(localStorage.getItem('song-nexus-playlist')).toBeNull();
  });

  it('ignores a saved room that isn’t readable', async () => {
    localStorage.setItem('song-nexus-room', '{');
    await show();
    expect(document.querySelector('.room-code')).toBeNull();
  });

  it('selects the long link when focused, and cancels an invitation', async () => {
    const { createRoom, ApiError } = await import('../api');
    vi.mocked(createRoom).mockRejectedValueOnce(Object.assign(new ApiError('No codes.', false), { unavailable: true }));
    codec.encode.mockResolvedValue('long');
    localStorage.setItem('song-nexus-playlist', JSON.stringify(mine));
    await show();
    await press(named('Get a code to share'));
    const link = document.querySelector<HTMLInputElement>('[aria-label="Your friend link"]')!;
    await act(async () => { link.focus(); });
    expect([link.selectionStart, link.selectionEnd]).toEqual([0, link.value.length]);
    await act(async () => root!.unmount());
    document.body.innerHTML = '';
    codec.decode.mockResolvedValueOnce(theirs);
    await show('/friends#a=x');
    await act(async () => { await Promise.resolve(); });
    await press(named('Cancel'));
    expect(window.location.pathname).toBe('/friends');
    expect(words()).toContain('Start a comparison');
  });
});
