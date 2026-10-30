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
    fetchMock.mockReturnValue(json({ similar: { artists: [], songs: [] } }));
    const [a, b] = await Promise.all([api.similarMusic('artist', ARTIST_ID), api.similarMusic('artist', ARTIST_ID)]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/similar?kind=artist&id=${ARTIST_ID}`);
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
