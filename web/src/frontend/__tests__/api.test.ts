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

  it('surfaces the route error message and retries after a failure', async () => {
    fetchMock.mockReturnValueOnce(json({ error: 'MusicBrainz is busy right now.', retryable: true }, 503));
    const failure = api.songDetails(ARTIST_ID);
    await expect(failure).rejects.toMatchObject({ name: 'ApiError', message: 'MusicBrainz is busy right now.', retryable: true });
    fetchMock.mockReturnValueOnce(json({ details: { id: 'ok' } }));
    await expect(api.songDetails(ARTIST_ID)).resolves.toEqual({ id: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports network failures as retryable and passes aborts through', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
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
    fetchMock.mockReturnValueOnce(json({ collaborators: { mutual: [] } }));
    await api.collaborators('a', 'b');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/musicbrainz/collaborators?a=a&b=b');
  });
});
