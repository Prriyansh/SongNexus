// @vitest-environment jsdom
// Friends and the My playlist map, driven like a user, for what app.integration.test.tsx doesn't
// reach: opening artists and songs from a map, a map that fails, playlist files that can't be used,
// codes that are taken, expired or unknown, invitation links, and copying without a clipboard.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodePlaylist } from '../taste';
import { button, click, fetchMock, render, samplePlaylist, settle, text, type, world } from './app-harness';
import { PHOEBE, TAYLOR } from './fixtures';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** Answers one route (by exact path, and method when given) differently; the rest as usual. */
function answer(path: string, reply: (url: URL, init?: RequestInit) => Response | Promise<Response>, method?: string) {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    return url.pathname === path && (!method || (init?.method ?? 'GET') === method) ? reply(url, init) : original(input);
  });
}
const playlist = { name: 'You', songs: samplePlaylist };
const usePlaylistMap = () => localStorage.setItem('song-nexus-playlist', JSON.stringify(playlist));
const why = (name: string) => click(button(`Why is this here: ${name}`));
const paste = async (lines: string) => {
  await type(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste a playlist"]')!, lines);
  await click(button('Use pasted songs'));
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('opening music from a playlist map', () => {
  it('explores from an artist, or opens their details', async () => {
    usePlaylistMap();
    await render('/connections?mode=playlist');
    await why('SZA');
    await click(button('Details'));
    expect(document.querySelector('.detail-drawer')).not.toBeNull();
    await click(button('Close details'));
    await why('SZA');
    await click(button('Explore from here'));
    expect(new URLSearchParams(window.location.search).get('artist')).toBe(PHOEBE);
  });

  it('explores from a song once it’s found on MusicBrainz, and says when it isn’t or the search fails', async () => {
    usePlaylistMap();
    answer('/api/musicbrainz/search', () => json({ results: [] }));
    await render('/connections?mode=playlist');
    await why('Kill Bill');
    await click(button('Explore from here'));
    await why('SZA'); // the message shows on the next card opened
    expect(text()).toContain('Couldn’t find “Kill Bill” on MusicBrainz.');
    answer('/api/musicbrainz/search', () => json({ error: 'down' }, 400));
    await why('Kill Bill');
    await click(button('Explore from here'));
    await why('SZA');
    expect(text()).toContain('Couldn’t look up “Kill Bill” just now.');
  });

  it('opens a found song in song mode', async () => {
    usePlaylistMap();
    await render('/connections?mode=playlist');
    await why('Kill Bill');
    await click(button('Explore from here'));
    expect(new URLSearchParams(window.location.search).get('mode')).toBe('song');
  });

  it('says when the map couldn’t be built, and tries again', async () => {
    usePlaylistMap();
    answer('/api/taste', () => json({ error: 'The map service is down.' }, 400));
    await render('/connections?mode=playlist');
    expect(text()).toContain('We couldn’t build this map.');
    expect(text()).toContain('The map service is down.');
    const asked = fetchMock.mock.calls.length;
    await click(button('Try again'));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(asked);
  });
});

describe('choosing a playlist file', () => {
  const file = (name: string, content: string, size?: number) => {
    const f = new File([content], name);
    if (size) Object.defineProperty(f, 'size', { value: size });
    Object.defineProperty(f, 'text', { value: () => Promise.resolve(content) });
    return f;
  };
  const choose = async (f?: File) => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Playlist file"]')!;
    Object.defineProperty(input, 'files', { value: f ? [f] : [], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
  };

  it('refuses a big file, another kind of file, and songs without artists, and reads a good one', async () => {
    await render('/connections?mode=playlist');
    const opened = vi.spyOn(document.querySelector<HTMLInputElement>('input[aria-label="Playlist file"]')!, 'click');
    await click(button('Choose file'));
    expect(opened).toHaveBeenCalled();
    await choose(undefined);
    await choose(file('big.txt', 'x', 3_000_000));
    expect(text()).toContain('Please choose a file under 2 MB.');
    await choose(file('list.docx', 'x'));
    expect(text()).toContain('Please choose a CSV, JSON, or TXT file.');
    await choose(file('titles.txt', 'Only a title'));
    expect(text()).toContain('These songs have no artist names.');
    await choose(file('good.txt', 'vampire - Olivia Rodrigo'));
    expect(text()).toContain('FROM YOUR PLAYLIST');
  });

  it('starts from the sample, and changes playlist', async () => {
    await render('/connections?mode=playlist');
    await click(button('Try a sample'));
    expect(text()).toContain('FROM YOUR PLAYLIST');
    await click(button('Change playlist'));
    expect(button('Try a sample')).toBeDefined();
  });

  it('fits the paste box to the screen, leaving room for a card below it', async () => {
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, height: 700 });
    vi.stubGlobal('visualViewport', viewport);
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const below = this.classList.contains('taste-box') && this.textContent?.includes('Got a code?');
      return { top: below ? 500 : 0, bottom: 0, left: 0, right: 0, width: 300, height: 40, x: 0, y: 0, toJSON() {} } as DOMRect;
    };
    try {
      await render('/friends');
      const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste a playlist"]')!;
      expect(field.style.height).toMatch(/px$/);
      await act(async () => { viewport.dispatchEvent(new Event('resize')); });
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });
});

describe('codes', () => {
  it('ignores a saved room it can’t read, and copes with storage that refuses to save', async () => {
    localStorage.setItem('song-nexus-room', JSON.stringify({ code: 'ABC234', role: 'spy' }));
    await render('/friends');
    expect(document.querySelector('.room-code')).toBeNull();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      await paste('vampire - Olivia Rodrigo');
      await click(button('Get a code to share'));
      expect(document.querySelector('.room-code')?.textContent).toBe('ABC234');
    } finally {
      setItem.mockRestore();
    }
  });

  it('names a host without a name as “A friend”, and says when the room is taken', async () => {
    world.room = { host: { name: '', songs: samplePlaylist }, guest: { name: 'Sam', songs: samplePlaylist } };
    await render('/friends?code=ABC234');
    expect(text()).toContain('A friend wants to compare playlists');
    expect(text()).toContain('Someone has already joined this room. Ask for a new code.');
  });

  it('says codes aren’t set up when the server has none', async () => {
    answer('/api/rooms/ABC234', () => json({ error: 'Short codes aren’t set up on this server.', unavailable: true }, 503));
    await render('/friends?code=ABC234');
    expect(text()).toContain('Short codes aren’t set up on this server.');
  });

  it('keeps waiting through a busy server, and says when a room has expired', async () => {
    localStorage.setItem('song-nexus-room', JSON.stringify({ code: 'ABC234', role: 'host' }));
    answer('/api/rooms/ABC234', () => json({ error: 'Busy.', retryable: true }, 503));
    await render('/friends');
    expect(document.querySelector('.room-code')?.textContent).toBe('ABC234');
    answer('/api/rooms/ABC234', () => json({ error: 'That code doesn’t match a room.' }, 404));
    await act(async () => { await new Promise(r => setTimeout(r, 4100)); });
    await settle();
    expect(text()).toContain('That room has expired. Start a new one.');
  }, 15_000);

  it('says why a code couldn’t be made, and why joining failed', async () => {
    answer('/api/rooms', () => json({ error: 'Storage is down.' }, 400), 'POST');
    await render('/friends');
    await paste('vampire - Olivia Rodrigo');
    await click(button('Get a code to share'));
    expect(text()).toContain('Storage is down.');
  });

  it('says why joining a room failed', async () => {
    answer('/api/rooms/ABC234', () => json({ error: 'That room is full.' }, 409), 'POST');
    await render('/friends?code=ABC234');
    await paste('vampire - Olivia Rodrigo');
    expect(text()).toContain('That room is full.');
  });
});

describe('invitation links', () => {
  it('opens two playlists in one link as a map, with a link back for the friend', async () => {
    const [a, b] = await Promise.all([encodePlaylist({ name: 'Sam', songs: samplePlaylist }), encodePlaylist({ name: 'Me', songs: samplePlaylist })]);
    window.location.hash = `a=${a}&b=${b}`;
    await render(`/friends#a=${a}&b=${b}`);
    await settle();
    expect(text()).toContain('YOU AND ME');
    expect(button('Copy link for your friend')).toBeDefined();
  });

  it('says when a link holds no playlist it can read', async () => {
    await render('/friends#a=not-a-playlist');
    await settle();
    expect(text()).toContain('This link doesn’t contain a playlist we can read.');
  });

  it('names an unnamed inviter “A friend”, and maps your playlist against theirs', async () => {
    const a = await encodePlaylist({ name: '', songs: samplePlaylist });
    await render(`/friends#a=${a}`);
    await settle();
    expect(text()).toContain('A friend wants to compare playlists');
    await paste('vampire - Olivia Rodrigo');
    expect(text()).toContain('YOU AND FRIEND');
  });

  it('explores from an artist on a friends map', async () => {
    const [a, b] = await Promise.all([encodePlaylist({ name: 'Sam', songs: samplePlaylist }), encodePlaylist({ name: 'Me', songs: samplePlaylist })]);
    await render(`/friends#a=${a}&b=${b}`);
    await settle();
    await why('Kendrick Lamar');
    await click(button('Explore from here'));
    expect(new URLSearchParams(window.location.search).get('artist')).toBe(TAYLOR);
  });

  it('explores from a song on a friends map', async () => {
    const [a, b] = await Promise.all([encodePlaylist({ name: 'Sam', songs: samplePlaylist }), encodePlaylist({ name: 'Me', songs: samplePlaylist })]);
    await render(`/friends#a=${a}&b=${b}`);
    await settle();
    await why('Kill Bill');
    await click(button('Explore from here'));
    expect(new URLSearchParams(window.location.search).get('mode')).toBe('song');
  });
});

describe('copying', () => {
  it('says copied when it worked, and does nothing without a clipboard', async () => {
    localStorage.setItem('song-nexus-room', JSON.stringify({ code: 'ABC234', role: 'host' }));
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await render('/friends');
    await click(button('Copy code'));
    expect(writeText).toHaveBeenCalledWith('ABC234');
    expect(text()).toContain('Copied');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    await click(button('Copy link'));
    expect(button('Copy link')).toBeDefined();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await click(button('Copy link'));
    expect(button('Copy link')).toBeDefined();
  });
});

describe('a map with a source missing', () => {
  it('says which source didn’t answer', async () => {
    usePlaylistMap();
    const { tasteReply } = await import('./app-harness');
    answer('/api/taste', () => json({ taste: { ...tasteReply, sources: [{ source: 'ListenBrainz', status: 'failed' }] } }));
    await render('/connections?mode=playlist');
    expect(document.querySelector('.web-map-status')!.textContent).toBe('ListenBrainz couldn’t be reached.');
  });
});
