// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimilarNode, SimilarWeb } from '@/lib/types';
import { ConnectionWebCanvas } from '../components/ConnectionWebCanvas';
import { buildWebEdges, connectionsOf, distanceFactor, layoutSimilarWeb, nodeOpacity } from '../similar-web';
import { similarWeb } from './fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
const onVisibleCount = vi.fn();
const node = (i: number, kind: 'artist' | 'song' = 'artist', similarity = 1 - i / 60): SimilarNode => ({ kind, id: `${kind}-${i}`, name: `${kind} ${i}`, subtitle: 'pop', imageUrl: null, similarity, rank: i, listeners: null, reasons: [{ kind: 'listeners', text: `Reason ${i}.` }] });
const crowded = (count = 54): SimilarWeb => ({ ...similarWeb, artists: Array.from({ length: count / 2 }, (_, i) => node(i)), songs: Array.from({ length: count / 2 }, (_, i) => node(i, 'song')), links: [] });
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
const render = async (web: SimilarWeb = crowded()) => { await act(async () => { root.render(<ConnectionWebCanvas nodes={(width, height) => layoutSimilarWeb(web, width, height)} edges={buildWebEdges(web)} near={id => connectionsOf(id, web)} actions={() => <button>Do something</button>} onVisibleCount={onVisibleCount} />); }); };
const flushFrame = async (now = 0) => { await act(async () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(now)); }); };
const pointer = async (type: string, x: number, y: number, target: Element = canvas(), id = 1) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: id === 1 } });
  await act(async () => { target.dispatchEvent(event); });
};
const click = async (target: Element, detail = 0) => { await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail })); }); };

describe('similarity map layout', () => {
  const distance = (nodes: { x: number; y: number }[], i: number, width = 1200, height = 600) => Math.hypot((nodes[i].x - width / 2) / width, (nodes[i].y - height / 2) / height);

  it('puts the selection in the center and is the same every time', () => {
    const nodes = layoutSimilarWeb(crowded(), 1200, 600);
    expect(nodes[0]).toMatchObject({ isCenter: true, x: 600, y: 300 });
    expect(layoutSimilarWeb(crowded(), 1200, 600)).toEqual(nodes);
  });

  it('places closer matches nearer the center: distance means something', () => {
    const web = { ...similarWeb, artists: [node(1, 'artist', .95), node(2, 'artist', .1)], songs: [], links: [] };
    const nodes = layoutSimilarWeb(web, 1200, 600);
    expect(distance(nodes, 1)).toBeLessThan(distance(nodes, 2));
    expect(distanceFactor(1)).toBeLessThan(distanceFactor(.2));
  });

  it('never lets a crowd pull something closer than its similarity says', () => {
    const nodes = layoutSimilarWeb(crowded(), 1200, 600);
    for (const n of nodes.filter(x => !x.isCenter)) {
      const rx = 1200 * .46, ry = 600 * .46;
      expect(Math.hypot((n.x - 600) / rx, (n.y - 300) / ry)).toBeGreaterThanOrEqual(distanceFactor(n.similarity) - 1e-6);
    }
  });

  it('keeps cards from overlapping', () => {
    const nodes = layoutSimilarWeb(crowded(), 1200, 600);
    for (let i = 1; i < nodes.length; i++) for (const other of nodes.slice(i + 1)) {
      expect(((nodes[i].x - other.x) / 96) ** 2 + ((nodes[i].y - other.y) / 88) ** 2).toBeGreaterThanOrEqual(.999);
    }
  });

  it('draws one similarity line per item, and keeps other links as their own kinds', () => {
    const edges = buildWebEdges(similarWeb);
    expect(edges.filter(e => e.kind === 'similarity')).toHaveLength(3);
    expect(edges.filter(e => e.kind === 'performed')).toHaveLength(1);
    expect(edges.filter(e => e.kind === 'neighbour')).toHaveLength(1);
    expect(connectionsOf(similarWeb.artists[0].id, similarWeb)).toEqual(['The Fate of Ophelia', 'Phoebe Bridgers']);
  });

  it('thins out when zoomed far out, keeping the closest few', () => {
    const [center, ...rest] = layoutSimilarWeb(crowded(), 1200, 600);
    expect(nodeOpacity(center, .62)).toBe(1);
    expect(nodeOpacity(rest.find(n => n.rank === 0)!, .62)).toBe(1);
    expect(nodeOpacity(rest.find(n => n.rank === 20)!, .62)).toBe(0);
    expect(nodeOpacity(rest.find(n => n.rank === 20)!, 1)).toBe(1);
  });
});

describe('Connection Web pan UX', () => {
  it('keeps nodes and artwork mounted through small and reverse pointer movements', async () => {
    await render();
    const original = visible().map(element => ({ element, style: element.getAttribute('style'), artwork: element.querySelector('.artist-avatar, .album-cover') }));
    expect(original.length).toBeGreaterThan(5);
    await pointer('pointerdown', 400, 250);
    for (const offset of [...Array.from({ length: 20 }, (_, i) => (i + 1) * 2), ...Array.from({ length: 20 }, (_, i) => (19 - i) * 2)]) {
      await pointer('pointermove', 400 + offset, 250); await flushFrame();
      for (const old of original) {
        expect(old.element.isConnected).toBe(true);
        expect(old.element.getAttribute('style')).toBe(old.style);
        expect(old.element.querySelector('.artist-avatar, .album-cover')).toBe(old.artwork);
      }
    }
    await pointer('pointerup', 400, 250);
    expect(world().style.transform).toBe('translate3d(0px, 0px, 0)');
    expect(canvas().hasAttribute('data-panning')).toBe(false);
    expect(onVisibleCount).toHaveBeenLastCalledWith(visible().length);
  });

  it('coalesces rapid pointer input into one frame and flushes the last position on release', async () => {
    await render();
    await pointer('pointerdown', 100, 100);
    for (const x of [110, 120, 130]) await pointer('pointermove', x, 100);
    expect(frames.size).toBe(1);
    await pointer('pointerup', 130, 100);
    expect(world().style.transform).toBe('translate3d(30px, 0px, 0)');
  });

  it('does not open an explanation after an avatar-origin drag, and the next click does', async () => {
    await render();
    const artist = visible().find(n => !n.classList.contains('anchor'))!;
    await pointer('pointerdown', 100, 100, artist);
    await pointer('pointermove', 150, 100, artist);
    await pointer('pointerup', 150, 100, artist);
    await click(artist, 1);
    expect(document.querySelector('.web-info-card')).toBeNull();
    await click(artist, 1);
    expect(document.querySelector('.web-info-card')).not.toBeNull();
  });

  it('pans with keyboard and horizontal wheel input, then resets', async () => {
    await render();
    canvas().focus();
    await act(async () => { canvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    expect(world().style.transform).toBe('translate3d(40px, 0px, 0)');
    await act(async () => { canvas().dispatchEvent(new WheelEvent('wheel', { deltaX: 30, bubbles: true, cancelable: true })); });
    await flushFrame();
    expect(world().style.transform).toBe('translate3d(10px, 0px, 0)');
    await click(button('Fit connection map'));
    expect(world().style.transform).toBe('translate3d(0px, 0px, 0)');
  });

  it('keeps buffered offscreen items out of the keyboard tab order', async () => {
    await render(crowded(160));
    const buffered = [...document.querySelectorAll<HTMLButtonElement>('.web-artist:not([data-in-viewport="true"])')];
    expect(buffered.length).toBeGreaterThan(0);
    for (const item of buffered) expect(item.tabIndex).toBe(-1);
    for (const item of visible()) expect(item.tabIndex).toBe(0);
  });

  it('animates distances through intermediate frames', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    await render();
    const started = performance.now();
    await click(button('Zoom in'));
    await flushFrame(started + 60);
    const middle = Number(document.querySelector('output')!.textContent!.replace('%', ''));
    expect(middle).toBeGreaterThan(100);
    expect(middle).toBeLessThan(135);
    await flushFrame(started + 400);
    expect(document.querySelector('output')!.textContent).toBe('135%');
  });

  it('keeps lines on the avatar edges at different scales', async () => {
    const web = { ...similarWeb, songs: [], links: [] };
    await render(web);
    const edge = buildWebEdges(web)[0];
    const verify = () => {
      const values = document.querySelector('.web-line-visible')!.getAttribute('d')!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
      const from = document.querySelector<HTMLElement>(`[data-artist-id="${edge.from}"]`)!, to = document.querySelector<HTMLElement>(`[data-artist-id="${edge.to}"]`)!;
      expect(Math.hypot(values[0] - parseFloat(from.style.left), values[1] - parseFloat(from.style.top) + 22)).toBeCloseTo(40);
      expect(Math.hypot(values[2] - parseFloat(to.style.left), values[3] - parseFloat(to.style.top) + 19)).toBeCloseTo(28);
    };
    verify(); await click(button('Zoom in')); verify();
  });

  it('previews why on hover, and pins it with actions on click', async () => {
    await render();
    const item = visible().find(n => !n.classList.contains('anchor'))!;
    await act(async () => { item.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
    expect(document.querySelector('.web-info-card.is-preview')).not.toBeNull();
    expect(document.querySelector('.web-info-actions')).toBeNull();
    await click(item, 1);
    expect(document.querySelector('.web-info-actions')).not.toBeNull();
  });
});
