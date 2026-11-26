// @vitest-environment jsdom
// The two zoom-in discovery hooks with the API replaced: what they add, de-duplicate, drop when
// the map has changed or the page has gone, and how they recover from a failure.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtistNeighborhood, SimilarWeb } from '@/lib/types';
import { similarWeb } from './fixtures';

const api = vi.hoisted(() => ({ similarArtistsOf: vi.fn(), discoverWebArtists: vi.fn(), artistNeighborhood: vi.fn() }));
vi.mock('../api', () => api);
import { MAX_DISCOVERIES, useSimilarDiscovery } from '../useSimilarDiscovery';
import { useWebDiscovery } from '../useWebDiscovery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
beforeEach(() => { root = createRoot(document.createElement('div')); });
afterEach(async () => { await act(async () => root.unmount()); vi.clearAllMocks(); });

/** A promise and the means to settle it, for answers that arrive when a test says. */
function later<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

let similarHook: ReturnType<typeof useSimilarDiscovery>;
/** Hands each render's answer to `report`, so tests can call what the hook returned. */
function SimilarProbe({ mapKey, report }: { mapKey: string; report: (hook: typeof similarHook) => void }) { report(useSimilarDiscovery(mapKey)); return null; }
let webHook: ReturnType<typeof useWebDiscovery>;
function WebProbe({ journey, report }: { journey: string[]; report: (hook: typeof webHook) => void }) { report(useWebDiscovery(journey)); return null; }

describe('useSimilarDiscovery', () => {
  // The same component each time, so a new key re-renders it rather than starting over.
  const render = (mapKey: string) => act(async () => root.render(<SimilarProbe mapKey={mapKey} report={h => { similarHook = h; }} />));

  it('adds what each zoom-in finds, once per artist, and up to a limit', async () => {
    api.similarArtistsOf.mockResolvedValue(similarWeb);
    await render('map');
    await act(async () => { similarHook.explore('a', 'A', 1.4); similarHook.explore('a', 'A', 1.6); });
    await flush();
    expect(similarHook.discoveries).toHaveLength(1);
    for (let i = 0; i < MAX_DISCOVERIES + 2; i++) await act(async () => similarHook.explore(`x${i}`, 'X', 1.4));
    await flush();
    expect(api.similarArtistsOf).toHaveBeenCalledTimes(MAX_DISCOVERIES);
  });

  it('drops an answer that arrives after the map changed, and starts the new map empty', async () => {
    const slow = later<SimilarWeb>();
    api.similarArtistsOf.mockReturnValueOnce(slow.promise).mockResolvedValue(similarWeb);
    await render('first');
    await act(async () => similarHook.explore('a', 'A', 1.4));
    await render('second');
    expect(similarHook.discoveries).toEqual([]);
    await act(async () => similarHook.explore('a', 'A', 1.4)); // a new map forgets what the old one asked
    await act(async () => { slow.resolve({ ...similarWeb, artists: [] }); }); // the old map's answer, late
    await flush();
    expect(similarHook.discoveries).toHaveLength(1);
    expect(similarHook.discoveries[0].similar).toBe(similarWeb);
  });

  it('remembers a failure, lets it be retried, and ignores a failure from a previous map', async () => {
    api.similarArtistsOf.mockRejectedValueOnce(new Error('down')).mockResolvedValue(similarWeb);
    await render('map');
    await act(async () => similarHook.retry()); // nothing to retry yet
    await act(async () => similarHook.explore('a', 'A', 1.4));
    await flush();
    expect(similarHook.failed).toEqual({ id: 'a', name: 'A', zoom: 1.4 });
    await act(async () => similarHook.retry());
    await flush();
    expect([similarHook.failed, similarHook.discoveries.length]).toEqual([null, 1]);

    const slow = later<SimilarWeb>();
    api.similarArtistsOf.mockReturnValueOnce(slow.promise);
    await act(async () => similarHook.explore('b', 'B', 1.4));
    await render('other');
    await act(async () => similarHook.explore('c', 'C', 1.4));
    await act(async () => { slow.reject(new Error('late')); });
    await flush();
    expect(similarHook.failed).toBeNull();
  });
});

describe('useWebDiscovery', () => {
  const render = (journey: string[]) => act(async () => root.render(<WebProbe journey={journey} report={h => { webHook = h; }} />));
  const artist = (id: string, tags: string[] = [], neighborhood = 'pop') => ({ id, name: id, tags, neighborhood, country: '', disambiguation: '', type: 'Person', lifeSpan: {} });
  const neighborhood = (ids: string[], failed: string[] = []): ArtistNeighborhood =>
    ({ artist: {} as never, artists: ids.map(id => ({ ...artist(id, id === 'untagged' ? [] : ['rock']), reasons: [] })), failed });

  it('ignores the first search’s answer when the journey changed before it came', async () => {
    const slow = later<{ artists: unknown[]; failed: string[] }>();
    api.discoverWebArtists.mockReturnValueOnce(slow.promise).mockResolvedValue({ artists: [artist('p')], failed: [] });
    await render(['pop']);
    await render(['rock']);
    await act(async () => { slow.resolve({ artists: [artist('stale')], failed: [] }); });
    await flush();
    expect(webHook.artists.map(a => a.id)).not.toContain('stale');
  });

  it('adds what a zoom-in finds, naming artists without tags as related, and says when part failed', async () => {
    api.discoverWebArtists.mockResolvedValue({ artists: [], failed: [] });
    api.artistNeighborhood.mockResolvedValue(neighborhood(['n1', 'untagged'], ['labels']));
    await render(['pop']);
    await flush();
    await act(async () => { await webHook.expand({ artistId: 'seed', x: 1, y: 2 }, 1.6); });
    expect(webHook.artists.map(a => [a.id, a.neighborhood, a.discoveryZoom])).toEqual([['n1', 'rock', 1.6], ['untagged', 'Related artist', 1.6]]);
    expect(webHook.partial).toBe(true);
  });

  it('says a failed zoom-in is partial, and retries it with what it asked for before', async () => {
    api.discoverWebArtists.mockResolvedValue({ artists: [], failed: [] });
    api.artistNeighborhood.mockRejectedValueOnce(new Error('down')).mockResolvedValue(neighborhood(['n1']));
    await render(['pop']);
    await flush();
    await act(async () => { await webHook.expand({ artistId: 'seed', x: 0, y: 0 }, 1.2); });
    expect(webHook.partial).toBe(true);
    await act(async () => { webHook.retry(); });
    await flush();
    expect([webHook.partial, webHook.artists.map(a => a.id)]).toEqual([false, ['n1']]);
  });

  it('retries only the broad search when no zoom-in has happened', async () => {
    api.discoverWebArtists.mockResolvedValue({ artists: [], failed: ['jazz'] });
    await render(['pop']);
    await flush();
    await act(async () => { webHook.retry(); });
    await flush();
    expect(api.discoverWebArtists).toHaveBeenCalledTimes(2);
    expect(api.artistNeighborhood).not.toHaveBeenCalled();
  });

  it('does nothing with a zoom-in answer once the page has gone', async () => {
    api.discoverWebArtists.mockResolvedValue({ artists: [], failed: [] });
    const slow = later<ArtistNeighborhood>();
    api.artistNeighborhood.mockReturnValueOnce(slow.promise);
    await render(['pop']);
    let pending!: Promise<void>;
    await act(async () => { pending = webHook.expand({ artistId: 'seed', x: 0, y: 0 }, 1.2); });
    const before = webHook;
    await act(async () => root.unmount());
    root = createRoot(document.createElement('div'));
    slow.resolve(neighborhood(['late']));
    await pending;
    expect(before.artists).toEqual([]);

    const failing = later<ArtistNeighborhood>();
    api.artistNeighborhood.mockReturnValueOnce(failing.promise);
    await render(['pop']);
    await act(async () => { pending = webHook.expand({ artistId: 'seed', x: 0, y: 0 }, 1.2); });
    await act(async () => root.unmount());
    root = createRoot(document.createElement('div'));
    failing.reject(new Error('late'));
    await pending;
  });

  it('asks nothing for an empty journey', async () => {
    await render([]);
    expect(api.discoverWebArtists).not.toHaveBeenCalled();
    expect(webHook.loading).toBe(false);
  });
});
