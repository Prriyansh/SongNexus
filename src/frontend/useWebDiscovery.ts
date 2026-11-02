import { useEffect, useRef, useState } from 'react';
import { artistNeighborhood, discoverWebArtists } from './api';
import { mergeDiscoveryArtists } from './connection-web';
import type { DiscoveryArtist, DiscoveryFocus } from './connection-web';

/** Both broad searches and local zoom expansions append to one retained map. */
export function useWebDiscovery(journey: string[]) {
  const key = JSON.stringify(journey);
  const [artists, setArtists] = useState<DiscoveryArtist[]>([]);
  const [base, setBase] = useState<{ key: string; failed: string[]; error?: Error }>({ key: '', failed: [] });
  const [attempt, setAttempt] = useState(0);
  const [focused, setFocused] = useState({ pending: 0, failed: [] as string[], error: '' });
  const counts = useRef(new Map<string, number>());
  const lastFocus = useRef<{ focus: DiscoveryFocus; zoom: number } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!journey.length) return;
    let active = true;
    discoverWebArtists(JSON.parse(key)).then(result => {
      if (!active) return;
      // Initial breadth stays small; every zoom-in adds additional local matches.
      const first = journey.flatMap(genre => result.artists.filter(a => a.neighborhood === genre).slice(0, 3));
      setArtists(previous => mergeDiscoveryArtists(previous, first));
      setBase({ key, failed: result.failed });
    }, error => { if (active) setBase({ key, failed: [], error: error instanceof Error ? error : new Error(String(error)) }); });
    return () => { active = false; };
    // The serialized journey is the stable identity of this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const expand = async (focus: DiscoveryFocus, zoom: number, retry = false) => {
    lastFocus.current = { focus, zoom };
    // Returning to a previous zoom restores cached detail instead of growing the pool per gesture.
    if (!retry) counts.current.set(focus.artistId, Math.max(counts.current.get(focus.artistId) ?? 0, Math.min(80, Math.max(10, Math.ceil((zoom - 1) / .5) * 10))));
    setFocused(previous => ({ ...previous, pending: previous.pending + 1, error: '' }));
    try {
      const result = await artistNeighborhood(focus.artistId);
      if (!alive.current) return;
      const count = counts.current.get(focus.artistId) ?? 10;
      const additions: DiscoveryArtist[] = result.artists.slice(0, count).map(a => ({ ...a,
        neighborhood: a.tags[0] ?? 'Related artist', originId: focus.artistId, focus: { x: focus.x, y: focus.y }, discoveryZoom: Math.max(1, zoom),
      }));
      setArtists(previous => mergeDiscoveryArtists(previous, additions));
      setFocused(previous => ({ ...previous, failed: result.failed }));
    } catch (error) {
      if (alive.current) setFocused(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Discovery failed.' }));
    } finally {
      if (alive.current) setFocused(previous => ({ ...previous, pending: Math.max(0, previous.pending - 1) }));
    }
  };
  const retry = () => { setAttempt(a => a + 1); if (lastFocus.current) void expand(lastFocus.current.focus, lastFocus.current.zoom, true); };
  return { artists, expand, retry,
    loading: !!journey.length && base.key !== key || focused.pending > 0,
    partial: !!base.failed.length || !!base.error || !!focused.failed.length || !!focused.error,
    error: focused.error || base.error?.message,
  };
}
