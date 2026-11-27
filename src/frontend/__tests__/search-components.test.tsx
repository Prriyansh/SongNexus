// @vitest-environment jsdom
// The two search boxes (Explore's pickers and first-visit setup) on their own, with the API
// replaced and time controlled: failed searches, the song library being down, picks that can't be
// found on MusicBrainz, answers that arrive after you've typed more, and every toggle.
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoundTrackBrief } from '@/lib/sound';
import { emptyProfile } from '../profile';
import { killBill, phoebe, vampireDetails } from './fixtures';

const api = vi.hoisted(() => ({ searchArtists: vi.fn(), searchSongs: vi.fn(), searchSoundSongs: vi.fn(), SEARCH_LIMIT: 24 }));
const resolve = vi.hoisted(() => ({ findRecording: vi.fn() }));
vi.mock('../api', () => api);
vi.mock('../resolve', () => resolve);
import { SearchChooser } from '../components/SearchChooser';
import { TasteSetup } from '../components/TasteSetup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.innerHTML = ''; vi.useRealTimers(); vi.clearAllMocks(); });

async function show(element: ReactElement) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(element));
  return host;
}
const words = () => document.body.textContent ?? '';
const press = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const named = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text) || b.getAttribute('aria-label') === text)!;
async function type(value: string, label?: string) {
  const input = document.querySelector<HTMLInputElement>(label ? `input[aria-label="${label}"]` : 'input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** Past the 300 ms debounce, and the answers after it. */
const wait = (ms = 300) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const dataset = (id: string, title: string, artists = ['X']): SoundTrackBrief => ({ id, title, artists, album: null, genre: 'pop', has_lyrics: true });

describe('the artist and song pickers', () => {
  const chooser = (type: 'artist' | 'song', onChange = vi.fn()) =>
    show(<SearchChooser type={type} value="" other="" label="PICK" onChange={onChange} profile={emptyProfile} />);
  const open = () => press(document.querySelector('.chooser-button')!);

  it('says when an artist search fails', async () => {
    api.searchArtists.mockRejectedValue(new Error('MusicBrainz is busy.'));
    await chooser('artist');
    await open();
    await type('phoebe');
    await wait();
    expect(words()).toContain('MusicBrainz is busy.');
  });

  it('closes on a press outside, not inside, and on Escape, returning focus to its button', async () => {
    api.searchArtists.mockResolvedValue([phoebe]);
    await chooser('artist');
    await open();
    await act(async () => { document.querySelector('.chooser-popover')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(document.querySelector('.chooser-popover')).not.toBeNull();
    await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(document.querySelector('.chooser-popover')).toBeNull();
    await open();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => { document.querySelector('input')!.dispatchEvent(escape); });
    expect(document.querySelector('.chooser-popover')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.chooser-button'));
    const closed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const spy = vi.spyOn(closed, 'stopPropagation');
    await act(async () => { document.querySelector('.chooser-button')!.dispatchEvent(closed); });
    expect(spy).not.toHaveBeenCalled();
  });

  it('opens a song from the library by finding it on MusicBrainz, and says when it can’t', async () => {
    api.searchSoundSongs.mockResolvedValue({ status: 'ok', results: [dataset('sp1', 'vampire'), dataset('sp2', 'Lost', [])] });
    const onChange = vi.fn();
    await chooser('song', onChange);
    await open();
    await type('va');
    await wait();
    expect(words()).toContain('Songs with full sound and lyrics analysis');
    resolve.findRecording.mockResolvedValueOnce(null);
    await press(named('Lost'));
    expect(resolve.findRecording).toHaveBeenLastCalledWith('Lost', '');
    expect(words()).toContain('Couldn’t find “Lost” on MusicBrainz.');
    resolve.findRecording.mockRejectedValueOnce(new Error('Search is down.'));
    await press(named('Lost'));
    expect(words()).toContain('Search is down.');
    resolve.findRecording.mockResolvedValueOnce(vampireDetails);
    await press(named('vampire'));
    expect(onChange).toHaveBeenCalledWith(vampireDetails.id);
    expect(document.querySelector('.chooser-popover')).toBeNull();
  });

  it('searches MusicBrainz when the song library is down or fails, and says so', async () => {
    api.searchSoundSongs.mockResolvedValueOnce({ status: 'unavailable' }).mockRejectedValueOnce(new Error('offline'));
    api.searchSongs.mockResolvedValue([killBill]);
    await chooser('song');
    await open();
    await type('kill');
    await wait();
    expect(words()).toContain('From MusicBrainz. Sound and lyrics analysis isn’t available right now.');
    await type('kill b');
    await wait();
    expect(api.searchSongs).toHaveBeenCalledTimes(2);
  });

  it('says when MusicBrainz fails too, or has nothing', async () => {
    api.searchSoundSongs.mockResolvedValue({ status: 'unavailable' });
    api.searchSongs.mockRejectedValueOnce(new Error('Both are down.')).mockResolvedValueOnce([]);
    await chooser('song');
    await open();
    await type('kill');
    await wait();
    expect(words()).toContain('Both are down.');
    await type('nothing');
    await wait();
    expect(words()).toContain('No matches in MusicBrainz.');
  });

  it('ignores answers to what you were typing before', async () => {
    let first!: (v: unknown) => void, second!: (v: unknown) => void, artistAnswer!: (v: unknown) => void, artistFail!: (e: unknown) => void;
    api.searchSoundSongs.mockImplementationOnce(() => new Promise(r => { first = r; }));
    api.searchSongs.mockImplementationOnce(() => new Promise(r => { second = r; }));
    await chooser('song');
    await open();
    await type('aa');
    await wait();
    await type('aab'); // aborts the first search
    await act(async () => { first({ status: 'ok', results: [dataset('late', 'Too late')] }); });
    expect(words()).not.toContain('Too late');
    api.searchSoundSongs.mockResolvedValueOnce({ status: 'unavailable' });
    await wait();
    await type('aabc');
    await act(async () => { second([killBill]); });
    expect(words()).not.toContain('Kill Bill');
    await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = '';

    api.searchArtists.mockImplementationOnce(() => new Promise(r => { artistAnswer = r; })).mockImplementationOnce(() => new Promise((_, f) => { artistFail = f; }));
    await chooser('artist');
    await open();
    await type('ph');
    await wait();
    await type('pho');
    await act(async () => { artistAnswer([phoebe]); });
    await wait();
    await type('phoe');
    await act(async () => { artistFail(new Error('late')); });
    expect(words()).not.toContain('late');
  });
});

describe('first-visit setup', () => {
  const setup = (onFinish = vi.fn()) => show(<TasteSetup onFinish={onFinish} />);

  it('toggles genres, picks and the way to discover off again, and goes back', async () => {
    api.searchArtists.mockResolvedValue([phoebe]);
    await setup();
    await press(named('Jazz'));
    expect(named('Jazz').getAttribute('aria-pressed')).toBe('true');
    await press(named('Jazz'));
    expect(named('Jazz').getAttribute('aria-pressed')).toBe('false');
    await press(named('Skip'));
    await type('phoebe', 'Search artists');
    await wait();
    await press(named('Phoebe Bridgers'));
    expect(named('Remove Phoebe Bridgers')).toBeTruthy();
    await press(document.querySelector('.setup-result')!); // the same result again takes it off
    expect(document.querySelector('[aria-label="Remove Phoebe Bridgers"]')).toBeNull();
    await press(named('Back'));
    expect(words()).toContain('Step 1 of 5');
    for (let i = 0; i < 3; i++) await press(named('Skip'));
    await press(named('Similar to what I love'));
    await press(named('Similar to what I love'));
    expect(named('Similar to what I love').getAttribute('aria-pressed')).toBe('false');
  });

  it('says when a search fails, and finishes from the name with Enter', async () => {
    api.searchSongs.mockRejectedValue(new Error('Search failed here.'));
    const onFinish = vi.fn();
    await setup(onFinish);
    await press(named('Skip'));
    await press(named('Skip'));
    await type('vampire', 'Search songs');
    await wait();
    expect(words()).toContain('Search failed here.');
    await press(named('Skip'));
    await press(named('Skip'));
    const name = document.querySelector<HTMLInputElement>('#setup-name')!;
    await type('Sam', undefined);
    await act(async () => { name.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); });
    expect(onFinish).not.toHaveBeenCalled();
    await act(async () => { name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sam' }));
  });

  it('ignores search answers that arrive after you typed more', async () => {
    let answer!: (v: unknown) => void, fail!: (e: unknown) => void;
    api.searchArtists.mockImplementationOnce(() => new Promise(r => { answer = r; })).mockImplementationOnce(() => new Promise((_, f) => { fail = f; }));
    await setup();
    await press(named('Skip'));
    await type('ph', 'Search artists');
    await wait();
    await type('pho', 'Search artists');
    await act(async () => { answer([phoebe]); });
    expect(words()).not.toContain('Phoebe Bridgers');
    await wait();
    await type('phoe', 'Search artists');
    await act(async () => { fail(new Error('too late')); });
    expect(words()).not.toContain('too late');
  });
});
