// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionWebCanvas } from '../components/ConnectionWebCanvas';
import { buildConnectionWeb } from '../connection-web';
import type { WebGraph } from '../connection-web';
import { collab, OLIVIA, oliviaDetails, taylorDetails, vampireDetails } from './fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
const onSelect = vi.fn(), onExplore = vi.fn(), onLevelChange = vi.fn(), onVisibleCount = vi.fn();
const graph = () => buildConnectionWeb({ mode: 'search', song: vampireDetails, lead: oliviaDetails }, Array.from({ length: 36 }, (_, i) => ({
  ...oliviaDetails, id: `peer-${i}`, name: `Artist ${i}`, neighborhood: ['pop', 'jazz', 'folk'][i % 3],
})), ['pop', 'jazz', 'folk']);
const canvas = () => document.querySelector<HTMLElement>('.web-map')!;
const world = () => document.querySelector<HTMLElement>('.web-world')!;
const visible = () => [...document.querySelectorAll<HTMLElement>('.web-artist[data-in-viewport="true"]')];
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

beforeEach(() => {
  vi.clearAllMocks(); frames = new Map(); let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id); }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: true })); // Functional checks use reduced motion; animation is tested separately.
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
const render = async (data = graph()) => { await act(async () => { root.render(<ConnectionWebCanvas graph={data} onSelect={onSelect} onExplore={onExplore} onLevelChange={onLevelChange} onVisibleCount={onVisibleCount} />); }); };
const flushFrame = async (now = 0) => { await act(async () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(now)); }); };
const pointer = async (type: string, x: number, y: number, target: Element = canvas(), id = 1) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: id === 1 } });
  await act(async () => { target.dispatchEvent(event); });
};
const click = async (target: Element, detail = 0) => { await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail })); }); };

describe('Connection Web pan UX', () => {
  it('keeps actual artist DOM nodes and artwork mounted through small and reverse pointer movements', async () => {
    await render();
    const original = visible().map(element => ({ element, style: element.getAttribute('style'), artwork: element.querySelector('.artist-avatar') }));
    await pointer('pointerdown', 400, 250);
    for (const offset of [...Array.from({ length: 40 }, (_, i) => (i + 1) * 2), ...Array.from({ length: 40 }, (_, i) => (39 - i) * 2)]) {
      await pointer('pointermove', 400 + offset, 250); await flushFrame();
      for (const old of original) {
        expect(old.element.isConnected).toBe(true);
        expect(old.element.getAttribute('style')).toBe(old.style);
        expect(old.element.querySelector('.artist-avatar')).toBe(old.artwork);
      }
    }
    await pointer('pointerup', 400, 250);
    expect(world().style.transform).toBe('translate3d(0px, 0px, 0)');
    expect(canvas().hasAttribute('data-panning')).toBe(false);
    expect(onExplore).not.toHaveBeenCalled();
    expect(onVisibleCount).toHaveBeenLastCalledWith(visible().length);
  });

  it('coalesces rapid pointer input into one frame and flushes the last position on release', async () => {
    await render(); await pointer('pointerdown', 50, 50);
    for (let i = 1; i <= 100; i++) await pointer('pointermove', 50 + i, 80);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    expect(world().style.transform).toBe('translate3d(0px, 0px, 0)');
    await pointer('pointerup', 150, 80);
    expect(world().style.transform).toBe('translate3d(100px, 30px, 0)');
    expect(frames.size).toBe(0);
  });

  it('does not open an artist after an avatar-origin drag, and the next ordinary click still works', async () => {
    await render(); const artist = button('View artist: Olivia Rodrigo');
    await pointer('pointerdown', 100, 100, artist); await pointer('pointermove', 145, 130); await flushFrame();
    expect(document.activeElement).toBe(canvas());
    await pointer('pointerup', 145, 130); await click(artist, 1);
    expect(onSelect).not.toHaveBeenCalled();
    await pointer('pointerdown', 145, 130, artist); await pointer('pointerup', 145, 130, artist); await click(artist, 1);
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'artist', id: OLIVIA });
    const nativeDrag = new Event('dragstart', { bubbles: true, cancelable: true });
    await act(async () => { artist.dispatchEvent(nativeDrag); });
    expect(nativeDrag.defaultPrevented).toBe(true);
  });

  it.each(['pointercancel', 'lostpointercapture', 'blur', 'Escape'])('ends dragging cleanly on %s', async end => {
    await render(); await pointer('pointerdown', 100, 100); await pointer('pointermove', 130, 115); await flushFrame();
    const stopped = world().style.transform;
    if (end === 'blur') await act(async () => { window.dispatchEvent(new Event('blur')); });
    else if (end === 'Escape') await act(async () => { canvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    else await pointer(end, 130, 115);
    expect(canvas().hasAttribute('data-panning')).toBe(false);
    await pointer('pointermove', 200, 200); await flushFrame();
    expect(world().style.transform).toBe(stopped);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('queues late catalog presentation until release and preserves existing artist elements afterward', async () => {
    const initial = graph(); initial.nodes = initial.nodes.slice(0, 3);
    await render(initial); const original = visible();
    await pointer('pointerdown', 300, 240); await pointer('pointermove', 320, 250); await flushFrame();
    const next: WebGraph = { ...initial, nodes: [...initial.nodes, { id: 'late-result', label: 'Late result', subtitle: 'Similar pop', discoveryGenre: 'pop', discoveryFocus: { x: 450, y: 270 }, entityType: 'artist', x: 0, y: 0 }] };
    await render(next);
    expect(document.querySelector('[data-artist-id="late-result"]')).toBeNull();
    for (const old of original) expect(old.isConnected).toBe(true);
    await pointer('pointerup', 320, 250); await click(button('Zoom in'));
    expect(document.querySelector('[data-artist-id="late-result"]')).not.toBeNull();
    for (const old of original) expect(old.isConnected).toBe(true);
  });

  it('keeps panning stable with keyboard and horizontal wheel input, then resets without changing zoom', async () => {
    await render(); const original = visible();
    await act(async () => { canvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    const wheel = new WheelEvent('wheel', { deltaX: 80, deltaY: 0, shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => { canvas().dispatchEvent(wheel); }); await flushFrame();
    expect(wheel.defaultPrevented).toBe(true);
    expect(world().style.transform).toBe('translate3d(-120px, 0px, 0)');
    for (const old of original) expect(old.isConnected).toBe(true);
    expect(document.querySelector('output')?.textContent).toBe('100%');
    expect(onExplore).not.toHaveBeenCalled();
    await click(button('Fit connection map'));
    expect(world().style.transform).toBe('translate3d(0px, 0px, 0)');
    expect(document.querySelector('.web-legend')).toBeNull();
  });

  it('preserves wheel zoom and horizontal offsets when input overlaps an active drag', async () => {
    await render(); await pointer('pointerdown', 50, 50); await pointer('pointermove', 100, 80); await flushFrame();
    await act(async () => { canvas().dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })); });
    const zoom = document.querySelector('output')?.textContent;
    const scale = Math.exp(.15);
    await act(async () => { canvas().dispatchEvent(new WheelEvent('wheel', { deltaX: 20, deltaY: 0, bubbles: true, cancelable: true })); });
    await pointer('pointermove', 150, 80); await flushFrame(); await pointer('pointerup', 150, 80);
    const translation = world().style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)!;
    expect(Number(translation[1])).toBeCloseTo(50 * scale + 30);
    expect(Number(translation[2])).toBeCloseTo(30 * scale);
    expect(document.querySelector('output')?.textContent).toBe(zoom);
    expect(zoom).not.toBe('100%');
  });

  it('keeps buffered offscreen artists out of the keyboard tab order', async () => {
    await render();
    const buffered = [...document.querySelectorAll<HTMLButtonElement>('.web-artist:not([data-in-viewport="true"])')];
    expect(buffered.length).toBeGreaterThan(0);
    for (const node of buffered) expect(node.tabIndex).toBe(-1);
    for (const node of visible()) expect(node.tabIndex).toBe(0);
  });

  it('animates distances through intermediate frames, scales the grid, and can be interrupted without a jump', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    await render();
    const artist = button('View artist: Olivia Rodrigo');
    const initial = Number(artist.style.left.replace('px', ''));
    await click(button('Zoom in'));
    expect(artist.style.left).toBe(`${initial}px`);
    await flushFrame(90);
    const intermediate = Number(artist.style.left.replace('px', ''));
    expect(intermediate).toBeGreaterThan(initial); expect(intermediate).toBeLessThan(initial * 1.35);
    expect(Number(document.querySelector<HTMLElement>('.web-map-grid')!.style.backgroundSize.split('px')[0])).toBeCloseTo(25 * intermediate / initial);
    const current = world().style.transform;
    await pointer('pointerdown', 400, 250);
    expect(frames.size).toBe(0); expect(world().style.transform).toBe(current);
    await pointer('pointerup', 400, 250);
    clock.mockRestore();
  });

  it('keeps outgoing detail mounted while fading and restores the same artist element on zoom-in', async () => {
    await render(); const original = visible();
    await click(button('Zoom out'));
    const fading = original.find(n => Number(n.dataset.detailOpacity) > .1 && Number(n.dataset.detailOpacity) < 1)!;
    expect(fading).toBeDefined();
    expect(fading.style.pointerEvents).not.toBe('none');
    await click(button('Zoom out'));
    expect(fading.isConnected).toBe(true); expect(Number(fading.dataset.detailOpacity)).toBe(0);
    expect(fading.classList.contains('is-hidden')).toBe(true); expect(fading.tabIndex).toBe(-1);
    await click(button('Zoom in')); await click(button('Zoom in'));
    expect(fading.isConnected).toBe(true); expect(Number(fading.dataset.detailOpacity)).toBe(1);
  });

  it('keeps documented lines attached to the projected avatar edges at different scales', async () => {
    const data = buildConnectionWeb({ mode: 'comparison', a: oliviaDetails, b: taylorDetails, collab }, [], ['pop']);
    await render(data);
    const edge = data.edges[0];
    const verify = () => {
      const values = document.querySelector('.web-line-visible')!.getAttribute('d')!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
      const from = document.querySelector<HTMLElement>(`[data-artist-id="${edge.from}"]`)!, to = document.querySelector<HTMLElement>(`[data-artist-id="${edge.to}"]`)!;
      expect(Math.hypot(values[0] - parseFloat(from.style.left), values[1] - parseFloat(from.style.top) + (from.classList.contains('anchor') ? 22 : 25))).toBeCloseTo(40);
      expect(Math.hypot(values[2] - parseFloat(to.style.left), values[3] - parseFloat(to.style.top) + (to.classList.contains('anchor') ? 22 : 25))).toBeCloseTo(40);
    };
    verify(); await click(button('Zoom in')); verify();
  });

  it('reverses wheel zoom from the displayed scale instead of continuing toward the old target', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    await render(); const artist = button('View artist: Olivia Rodrigo');
    await act(async () => { canvas().dispatchEvent(new WheelEvent('wheel', { deltaY: -900, clientX: 450, clientY: 270, bubbles: true, cancelable: true })); });
    await flushFrame(36);
    const intermediate = parseFloat(artist.style.left);
    await act(async () => { canvas().dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 450, clientY: 270, bubbles: true, cancelable: true })); });
    await flushFrame(180);
    expect(parseFloat(artist.style.left)).toBeLessThan(intermediate);
    clock.mockRestore();
  });
});
