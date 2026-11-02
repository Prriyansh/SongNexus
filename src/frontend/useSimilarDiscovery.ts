import { useCallback, useRef, useState } from 'react';
import { similarArtistsOf } from './api';
import type { Discovery } from './similar-web';

/** Bounds the map: at most this many zoom-ins load more, each adding up to ten artists. */
export const MAX_DISCOVERIES = 6;

type Request = { id: string; name: string; zoom: number };
type DiscoveryState = { key: string; discoveries: Discovery[]; loading: Request | null; failed: Request | null };

/**
 * Artists similar to whichever one you zoom in on, added to the map for `mapKey`. Requests are
 * de-duplicated, late answers for a previous map are dropped, and a failure keeps what's loaded.
 */
export function useSimilarDiscovery(mapKey: string) {
  const [state, setState] = useState<DiscoveryState>({ key: mapKey, discoveries: [], loading: null, failed: null });
  const requested = useRef({ key: mapKey, ids: new Set<string>() });
  const current = state.key === mapKey ? state : { key: mapKey, discoveries: [], loading: null, failed: null };

  const load = useCallback((request: Request) => {
    setState(s => ({ ...(s.key === mapKey ? s : { key: mapKey, discoveries: [] }), loading: request, failed: null }));
    similarArtistsOf(request.id).then(
      similar => setState(s => s.key !== mapKey ? s : { ...s, discoveries: [...s.discoveries, { via: { id: request.id, name: request.name }, zoom: request.zoom, similar }], loading: null }),
      () => {
        requested.current.ids.delete(request.id);
        setState(s => s.key !== mapKey ? s : { ...s, loading: null, failed: request });
      },
    );
  }, [mapKey]);

  const explore = useCallback((id: string, name: string, zoom: number) => {
    if (requested.current.key !== mapKey) requested.current = { key: mapKey, ids: new Set() };
    const ids = requested.current.ids;
    if (ids.has(id) || ids.size >= MAX_DISCOVERIES) return;
    ids.add(id);
    load({ id, name, zoom });
  }, [mapKey, load]);

  const retry = useCallback(() => { if (current.failed) explore(current.failed.id, current.failed.name, current.failed.zoom); }, [current.failed, explore]);
  return { discoveries: current.discoveries, loading: current.loading, failed: current.failed, explore, retry };
}
