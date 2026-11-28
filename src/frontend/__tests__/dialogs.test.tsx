// @vitest-environment jsdom
// The dialog every overlay uses, and the playlist upload, on their own: keyboard focus that stays
// inside, closing by Escape or the backdrop, and every way a playlist file can go wrong.
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/lib/types';
import { killBill, vampireDetails } from './fixtures';

const api = vi.hoisted(() => ({ searchSongs: vi.fn() }));
vi.mock('../api', () => api);
import { Modal } from '../components/Modal';
import { PlaylistUpload } from '../components/PlaylistUpload';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Browsers have File.text(); jsdom doesn't, so read it the older way.
if (!('text' in File.prototype)) {
  Object.defineProperty(File.prototype, 'text', {
    configurable: true,
    value(this: File) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    },
  });
}
let root: Root | null = null;
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.innerHTML = ''; vi.clearAllMocks(); });

async function show(element: ReactElement, withAppRoot = false) {
  const host = document.createElement('div');
  if (withAppRoot) host.id = 'root';
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  return host;
}
const key = (name: string, shiftKey = false) => {
  const event = new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
/** Lets file reads and searches finish. */
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)); }); };

describe('the dialog', () => {
  const three = (onClose = vi.fn()) => <Modal label="Test" onClose={onClose}><button>One</button><button>Two</button><button>Three</button></Modal>;

  it('starts on its first control, keeps Tab inside, and lets Tab move freely in the middle', async () => {
    await show(three());
    const [one, two, three_] = [...dialog().querySelectorAll('button')];
    expect(document.activeElement).toBe(one);
    expect(key('Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(three_);
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(one);
    two.focus();
    expect(key('Tab').defaultPrevented).toBe(false);
    expect(key('Tab', true).defaultPrevented).toBe(false);
    expect(key('a').defaultPrevented).toBe(false);
  });

  it('focuses itself when it has no controls, and keeps Tab there', async () => {
    await show(<Modal label="Empty" onClose={vi.fn()}><p>Nothing to press</p></Modal>);
    expect(document.activeElement).toBe(dialog());
    expect(key('Tab').defaultPrevented).toBe(true);
  });

  it('goes back to the last control from the dialog itself with Shift+Tab', async () => {
    await show(three());
    dialog().focus();
    key('Tab', true);
    expect(document.activeElement!.textContent).toBe('Three');
  });

  it('closes on Escape and on the backdrop, but not on a press inside', async () => {
    const onClose = vi.fn();
    await show(three(onClose));
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { dialog().dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { document.querySelector('.modal-scrim')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('makes the page behind inert while open, and gives it back on close', async () => {
    const page = await show(<div />, true);
    const inner = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => inner.render(three()));
    expect(page.inert).toBe(true);
    await act(async () => inner.unmount());
    expect(page.inert).toBe(false);
  });
});

describe('the playlist upload', () => {
  const file = (name: string, text: string, size?: number) => {
    const f = new File([text], name);
    if (size) Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  const choose = async (f: File | undefined) => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: f ? [f] : [], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
  };
  const words = () => document.body.textContent ?? '';
  const render = (onImport = vi.fn(), onClose = vi.fn()) => show(<PlaylistUpload onClose={onClose} onImport={onImport} />);

  it('refuses files that are too big, of another kind, or unreadable', async () => {
    await render();
    await choose(file('big.csv', 'x', 3_000_000));
    expect(words()).toContain('Please choose a file under 2 MB.');
    await choose(file('notes.docx', 'x'));
    expect(words()).toContain('Please choose a CSV, JSON, or TXT file.');
    await choose(file('empty.csv', ''));
    expect(words()).toContain('The playlist file is empty.');
    const broken = file('broken.txt', 'x');
    Object.defineProperty(broken, 'text', { value: () => Promise.reject(new Error('Could not read it.')) });
    await choose(broken);
    expect(words()).toContain('Could not read it.');
  });

  it('does nothing when the chooser is closed without a file', async () => {
    await render();
    await choose(undefined);
    expect(api.searchSongs).not.toHaveBeenCalled();
  });

  it('matches a chosen file row by row, says what wasn’t found or failed, and imports the rest', async () => {
    api.searchSongs.mockImplementation(async (query: string) => {
      if (query.includes('Broken')) throw new Error('MusicBrainz is busy.');
      return query.includes('vampire') ? [vampireDetails] : [];
    });
    const onImport = vi.fn();
    await render(onImport);
    await choose(file('mine.txt', 'vampire — Olivia Rodrigo\nMissing — Nobody\nBroken — Someone'));
    expect(words()).toContain('Matched');
    expect(words()).toContain('Not found');
    expect(words()).toContain('Search failed');
    expect(words()).toContain('MusicBrainz is busy.');
    expect(words()).toContain('2 unmatched entries will be skipped.');
    await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent?.startsWith('Import'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onImport).toHaveBeenCalledWith([vampireDetails]);
  });

  it('matches only the first 50 rows of a long file, and says how many it left', async () => {
    api.searchSongs.mockResolvedValue([]);
    await render();
    await choose(file('long.txt', Array.from({ length: 60 }, (_, i) => `Song ${i} — Artist`).join('\n')));
    await settle();
    expect(words()).toContain('plus 10 rows past the first 50');
  });

  it('reads a dropped file, opens the chooser from its button, and remembers the source picked', async () => {
    api.searchSongs.mockResolvedValue([killBill as Song]);
    await render();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const opened = vi.spyOn(input, 'click');
    await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Choose file'))!.click(); });
    expect(opened).toHaveBeenCalled();
    await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent === 'Apple Music')!.click(); });
    expect([...document.querySelectorAll('[aria-pressed="true"]')].map(b => b.textContent)).toEqual(['Apple Music']);
    const zone = document.querySelector('.drop-zone')!;
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    zone.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const drop = Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: { files: [file('dropped.txt', 'Kill Bill — SZA')] } });
    await act(async () => { zone.dispatchEvent(drop); });
    await settle();
    expect(words()).toContain('dropped.txt');
    expect(words()).toContain('1 unique matches');
  });

  it('stops matching quietly when closed partway', async () => {
    let finish!: (songs: Song[]) => void;
    api.searchSongs.mockImplementationOnce((_q: string, signal: AbortSignal) => new Promise((resolve, reject) => {
      finish = resolve;
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    await render();
    await choose(file('mine.txt', 'vampire — Olivia Rodrigo\nSecond — Someone'));
    await act(async () => root!.unmount());
    root = null;
    expect(api.searchSongs).toHaveBeenCalledTimes(1); // the second row was never asked about
    void finish;
  });
});

describe('closing the upload', () => {
  it('uses the close button', async () => {
    const onClose = vi.fn();
    await show(<PlaylistUpload onClose={onClose} onImport={vi.fn()} />);
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Close upload"]')!.click(); });
    expect(onClose).toHaveBeenCalled();
  });
});
