// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useAsync } from '../useAsync';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Renders the hook for `key`, returning its latest answer and a way to settle the load. */
async function mount(key: string) {
  let settle!: { resolve: (v: string) => void; reject: (e: unknown) => void };
  const load = () => new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
  const seen: ReturnType<typeof useAsync<string>>[] = [];
  function Probe() {
    seen.push(useAsync(key, load));
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
  return { seen, settle: () => settle, root };
}

describe('useAsync', () => {
  it('ignores a result that arrives after the component has gone', async () => {
    const { seen, settle, root } = await mount('a');
    await act(async () => root.unmount());
    const count = seen.length;
    await act(async () => settle().resolve('late'));
    expect(seen.length).toBe(count);
  });

  it('ignores a failure that arrives after the component has gone', async () => {
    const { seen, settle, root } = await mount('a');
    await act(async () => root.unmount());
    const count = seen.length;
    await act(async () => settle().reject(new Error('late')));
    expect(seen.length).toBe(count);
  });

  it('turns a failure that isn’t an Error into one', async () => {
    const { seen, settle, root } = await mount('a');
    await act(async () => settle().reject('just a string'));
    expect(seen.at(-1)!.error).toEqual(new Error('just a string'));
    await act(async () => root.unmount());
  });
});
