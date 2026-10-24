import { useEffect, useState } from 'react';

/**
 * Loads data for a key (null = nothing to load). While the key's result hasn't arrived,
 * `loading` is true and `data` is undefined, so a new selection never shows the old one's data.
 */
export function useAsync<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data?: T; error?: Error }>({ key: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    let live = true;
    load().then(
      data => { if (live) setState({ key, data }); },
      error => { if (live) setState({ key, error: error instanceof Error ? error : new Error(String(error)) }); }
    );
    return () => { live = false; };
    // `load` is recreated every render; the key identifies what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const current = key !== null && state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: key !== null && !current,
    retry: () => { setState({ key: null }); setAttempt(n => n + 1); },
  };
}
