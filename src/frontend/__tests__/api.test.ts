import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ARTIST_ID = '20244d07-534f-4eff-b4d4-930878889970';

// The client memoises by id across the module, so each test gets a fresh copy.
let api: typeof import('../api');
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  api = await import('../api');
  api.retryPolicy.delayMs = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('calls our own search route with an encoded query and limit', async () => {
    fetchMock.mockReturnValueOnce(json({ results: [{ id: '1' }] }));
    expect(await api.searchArtists('AC/DC & friends')).toEqual([{ id: '1' }]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/musicbrainz/search?type=artist&limit=24&q=AC%2FDC%20%26%20friends');
    fetchMock.mockReturnValueOnce(json({ results: [] }));
    await api.searchSongs('x y', undefined, 10);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/musicbrainz/search?type=recording&limit=10&q=x%20y');
  });

  it('fetches each artist once and shares the result', async () => {
    fetchMock.mockReturnValue(json({ details: { id: ARTIST_ID } }));
    const [a, b] = await Promise.all([api.artistDetails(ARTIST_ID), api.artistDetails(ARTIST_ID)]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/musicbrainz/details?type=artist&id=${ARTIST_ID}`);
  });

  it('asks for similar music by kind and id, and shares the result', async () => {
    fetchMock.mockReturnValue(json({ similar: { artists: [], songs: [], sources: [] } }));
    const [a, b] = await Promise.all([api.similarMusic('artist', ARTIST_ID), api.similarMusic('artist', ARTIST_ID)]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/similar?kind=artist&id=${ARTIST_ID}`);
  });

  it('asks for similar artists only (no songs) for the zoom-in, cached apart from the full map', async () => {
    fetchMock.mockReturnValue(json({ similar: { artists: [], songs: [], sources: [] } }));
    await api.similarArtistsOf(ARTIST_ID);
    await api.similarArtistsOf(ARTIST_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/similar?kind=artist&id=${ARTIST_ID}&songs=0`);
  });

  it('retries a busy (retryable) error once before giving up', async () => {
    fetchMock.mockReturnValueOnce(json({ error: 'MusicBrainz is busy right now.', retryable: true }, 503));
    fetchMock.mockReturnValueOnce(json({ details: { id: 'ok' } }));
    await expect(api.songDetails(ARTIST_ID)).resolves.toEqual({ id: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces the route error after the retry fails, and refetches on the next call', async () => {
    const busy = () => json({ error: 'MusicBrainz is busy right now.', retryable: true }, 503);
    fetchMock.mockReturnValueOnce(busy()).mockReturnValueOnce(busy());
    await expect(api.songDetails(ARTIST_ID)).rejects.toMatchObject({ name: 'ApiError', message: 'MusicBrainz is busy right now.', retryable: true });
    fetchMock.mockReturnValueOnce(json({ details: { id: 'ok' } }));
    await expect(api.songDetails(ARTIST_ID)).resolves.toEqual({ id: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry errors that will not change (bad input, not found)', async () => {
    fetchMock.mockReturnValueOnce(json({ error: 'Query param "id" must be a MusicBrainz UUID.' }, 400));
    await expect(api.artistDetails('bad')).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports network failures as retryable and passes aborts through', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.collaborators('a', 'b')).rejects.toMatchObject({ retryable: true, message: expect.stringMatching(/Could not reach/) });
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValueOnce(abort);
    await expect(api.searchArtists('xx')).rejects.toBe(abort);
  });

  it('asks for top tracks with the artist name and accepts "no match"', async () => {
    fetchMock.mockReturnValueOnce(json({ track: null }));
    expect(await api.topTrack(ARTIST_ID, 'Sigur Rós')).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/top-track?id=${ARTIST_ID}&name=Sigur%20R%C3%B3s`);
  });

  it('uses the collaborators route with both ids', async () => {
    fetchMock.mockReturnValueOnce(json({ collaborators: { mutual: [], coverage: { a: {}, b: {} } } }));
    await api.collaborators('a', 'b');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/musicbrainz/collaborators?a=a&b=b');
  });

  it('remembers a finished scan, but asks again after a partial one so it can continue', async () => {
    const reply = (partial: boolean) => json({ collaborators: { mutual: [], coverage: { a: { partial }, b: {} } } });
    fetchMock.mockReturnValueOnce(reply(true)).mockReturnValueOnce(reply(false));
    await api.collaborators('a', 'b');
    await api.collaborators('a', 'b');
    await api.collaborators('a', 'b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('api client: the rest', () => {
  it('doesn’t retry a request that was cancelled while it waited to', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(() => { controller.abort(); return json({ error: 'busy', retryable: true }, 503); });
    await expect(api.searchSongs('xx', controller.signal)).rejects.toMatchObject({ message: 'busy' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const late = new AbortController();
    api.retryPolicy.delayMs = 5;
    fetchMock.mockImplementationOnce(() => { setTimeout(() => late.abort(), 1); return json({ error: 'busy', retryable: true }, 503); });
    await expect(api.searchSongs('yy', late.signal)).rejects.toMatchObject({ message: 'busy' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('names the status when an error has no message, and treats an unavailable service as not worth retrying', async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response('not json', { status: 418 })));
    await expect(api.artistDetails(ARTIST_ID)).rejects.toMatchObject({ message: 'Request failed (418).', retryable: false });
    fetchMock.mockReturnValueOnce(json({ error: 'Not set up.', unavailable: true }, 503));
    await expect(api.createRoom({ name: '', songs: [] })).rejects.toMatchObject({ unavailable: true, retryable: false });
  });

  it('searches each style with its closest other tag, leaves out placeholders, and asks again after a failure', async () => {
    const artist = (name: string, tags: string[] = []) => ({ id: name, name, tags });
    fetchMock.mockImplementation((url: string) => {
      const q = new URL(url, 'http://x').searchParams.get('q')!;
      if (q.includes('jazz')) return json({ error: 'down' }, 400);
      return json({ results: [artist('Real'), artist('Various Artists'), artist('Odd', ['Special Purpose'])] });
    });
    const first = await api.discoverWebArtists(['pop', 'jazz'], [['pop', 'synth-pop']]);
    expect(first.failed).toEqual(['jazz']);
    expect(first.artists.map(a => [a.name, a.neighborhood])).toEqual([['Real', 'pop']]);
    expect(fetchMock.mock.calls.map(([u]) => new URL(u, 'http://x').searchParams.get('q'))).toContain('tag:"pop" AND tag:"synth-pop"');
    await api.discoverWebArtists(['pop', 'jazz'], [['pop', 'synth-pop']]);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('jazz')).length).toBe(2);
  });

  it('asks again for a neighborhood that came back partial, but not for a complete one', async () => {
    fetchMock.mockReturnValueOnce(json({ neighborhood: { artists: [], failed: ['labels'] } })).mockReturnValue(json({ neighborhood: { artists: [], failed: [] } }));
    await api.artistNeighborhood(ARTIST_ID);
    await api.artistNeighborhood(ARTIST_ID);
    await api.artistNeighborhood(ARTIST_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('compares songs whose artists are unknown with empty artist names', async () => {
    fetchMock.mockReturnValueOnce(json({ status: 'unavailable' }));
    const song = (id: string) => ({ id, title: id, artists: [] }) as never;
    await api.soundComparison(song('a'), song('b'));
    const q = new URL(fetchMock.mock.calls[0][0], 'http://x').searchParams;
    expect([q.get('aArtist'), q.get('bArtist')]).toEqual(['', '']);
  });
});

describe('api client: similar music', () => {
  it('asks again for a map with a source that failed, but keeps a complete one', async () => {
    fetchMock.mockReturnValueOnce(json({ similar: { artists: [], songs: [], sources: [{ source: 'Deezer', status: 'failed' }] } }))
      .mockReturnValue(json({ similar: { artists: [], songs: [], sources: [{ source: 'Deezer', status: 'ok' }] } }));
    await api.similarMusic('artist', ARTIST_ID);
    await api.similarMusic('artist', ARTIST_ID);
    await api.similarMusic('artist', ARTIST_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
