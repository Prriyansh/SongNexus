// @vitest-environment jsdom
// Helen's two map canvases with the input their own tests don't send: wheels in lines and pages,
// sideways scrolling, zooming while dragging or mid-animation, a second finger, presses on the
// controls, keys on a child, a hidden map, and every kind of explanation card.
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimilarWeb } from '@/lib/types';
import { ComparisonWebCanvas } from '../components/ComparisonWebCanvas';
import { ConnectionWebCanvas } from '../components/ConnectionWebCanvas';
import { buildConnectionWeb } from '../connection-web';
import { buildWebEdges, layoutSimilarWeb } from '../similar-web';
import type { WebNode } from '../similar-web';
import { collab, oliviaDetails, similarWeb, taylorDetails } from './fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
let size = { width: 900, height: 540 };
let resizeObservers: (() => void)[] = [];
let reducedMotion = true;
beforeEach(() => {
  frames = new Map(); let next = 0;
  size = { width: 900, height: 540 }; resizeObservers = []; reducedMotion = true;
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { const id = ++next; frames.set(id, cb); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id); }));
  vi.stubGlobal('ResizeObserver', class { constructor(private tell: () => void) { resizeObservers.push(() => this.tell()); } observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
  Element.prototype.getBoundingClientRect = function () { return { ...size, left: 0, top: 0, right: size.width, bottom: size.height, x: 0, y: 0, toJSON() {} } as DOMRect; };
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.useRealTimers(); });

const show = (element: ReactElement) => act(async () => root.render(element));
const map = () => document.querySelector<HTMLElement>('.web-map')!;
const zoom = () => document.querySelector('output[aria-label="Map zoom"]')!.textContent;
const pan = () => document.querySelector<HTMLElement>('.web-world')!.style.transform;
// Frame times are in performance.now() terms; the default is far enough ahead to finish any animation.
const flush = (now = performance.now() + 10_000) => act(async () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(cb => cb(now)); });
async function pointer(type: string, x: number, y: number, extra: { id?: number; target?: Element; button?: number; primary?: boolean } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: extra.button ?? 0, clientX: x, clientY: y });
  Object.defineProperties(event, { pointerId: { value: extra.id ?? 1 }, isPrimary: { value: extra.primary ?? true } });
  await act(async () => { (extra.target ?? map()).dispatchEvent(event); });
  return event;
}
async function wheel(init: WheelEventInit, target: Element = map()) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 450, clientY: 270, ...init });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
const key = (k: string, target: Element = map()) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });

/** Behaviour both canvases share, run against each. */
function sharedCases(render: () => Promise<void>, cardSelector: string, openCard: () => Promise<void>) {
  it('reads wheels in lines and pages, scrolls sideways, and ignores a still wheel', async () => {
    await render();
    await wheel({ deltaY: -2, deltaMode: 1 });
    const afterLines = zoom();
    expect(afterLines).not.toBe('100%');
    size = { ...size, height: 0 };
    await wheel({ deltaY: -0.2, deltaMode: 2 }); // a page of an unmeasured map counts as 500 px
    size = { width: 900, height: 540 };
    const before = pan();
    await wheel({ deltaX: 50, deltaY: 0 });
    await flush();
    expect(pan()).not.toBe(before);
    await wheel({ deltaY: 30, shiftKey: true }); // shift turns a vertical wheel sideways
    await flush();
    const still = zoom();
    await wheel({ deltaX: 0, deltaY: 0 });
    expect(zoom()).toBe(still);
  });

  it('zooms faster with Ctrl, and moves the drag along when zooming or scrolling mid-drag', async () => {
    await render();
    await wheel({ deltaY: -50, ctrlKey: true });
    const ctrl = Number(zoom()!.replace('%', ''));
    expect(ctrl).toBeGreaterThan(120);
    await pointer('pointerdown', 100, 100);
    await pointer('pointermove', 160, 100);
    await wheel({ deltaY: -20 });
    await wheel({ deltaX: 40 });
    await pointer('pointermove', 200, 100);
    await flush();
    await pointer('pointerup', 200, 100);
    expect(map().hasAttribute('data-panning')).toBe(false);
  });

  it('builds on a zoom still animating, and lets a newer one take over', async () => {
    reducedMotion = false;
    await render();
    await wheel({ deltaY: -40 });
    await wheel({ deltaY: -40 }); // same direction: starts from where the first is heading
    vi.mocked(cancelAnimationFrame).mockImplementationOnce(() => {}); // a frame that slips through
    const stale = [...frames.values()];
    await wheel({ deltaY: 40 });
    await act(async () => { stale.forEach(cb => cb(1000)); }); // the old animation's frame does nothing
    await flush(performance.now());
    await flush();
    const settled = Number(zoom()!.replace('%', ''));
    await key('+'); await key('+'); // the second press builds on the first, still animating
    await flush();
    expect(Number(zoom()!.replace('%', ''))).toBeCloseTo(settled * 1.35 * 1.35, -1);
    await key('+');
    await wheel({ deltaX: 30 }); // scrolling mid-animation stops it
    await flush();
    expect(frames.size).toBe(0);
  });

  it('pans and zooms from the keyboard only when the map itself has focus', async () => {
    await render();
    const child = document.querySelector('.web-artist')!;
    const before = pan();
    await key('ArrowLeft', child);
    expect(pan()).toBe(before);
    await key('ArrowRight'); await key('ArrowUp'); await key('ArrowDown');
    await key('=');
    expect(zoom()).toBe('135%');
    await key('-');
    expect(zoom()).toBe('100%');
    await key('x');
    await key('0');
    expect(pan()).toBe('translate3d(0px, 0px, 0)');
  });

  it('ignores presses that aren’t a first finger’s main button on the map, and other pointers', async () => {
    await render();
    const before = pan();
    await pointer('pointerdown', 100, 100, { button: 2 });
    await pointer('pointerdown', 100, 100, { primary: false, id: 2 });
    await pointer('pointerdown', 100, 100, { target: document.querySelector('.web-map-controls button')! });
    await pointer('pointermove', 200, 100);
    expect(pan()).toBe(before);
    await pointer('pointerdown', 100, 100);
    await pointer('pointerdown', 300, 100, { id: 2 }); // a second finger doesn't start another drag
    await pointer('pointermove', 300, 300, { id: 2 });
    await pointer('pointerup', 300, 300, { id: 2 });
    await pointer('pointercancel', 300, 300, { id: 2 });
    await pointer('lostpointercapture', 300, 300, { id: 2 });
    expect(pan()).toBe(before);
    Element.prototype.hasPointerCapture = () => true;
    const release = vi.fn();
    Element.prototype.releasePointerCapture = release;
    await pointer('pointercancel', 100, 100);
    expect(release).toHaveBeenCalled();
    await pointer('pointerdown', 100, 100);
    await pointer('lostpointercapture', 100, 100);
    delete (Element.prototype as { hasPointerCapture?: unknown }).hasPointerCapture;
  });

  it('keeps hover where it was while dragging across artists', async () => {
    await render();
    const artist = document.querySelectorAll('.web-artist')[1];
    await pointer('pointerdown', 100, 100);
    await pointer('pointermove', 200, 100);
    await act(async () => { artist.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); artist.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })); });
    await pointer('pointerup', 200, 100);
    expect(document.querySelector('.web-line.muted')).toBeNull();
  });

  it('keeps its size while hidden, and when told the same size again', async () => {
    await render();
    const before = document.querySelector<HTMLElement>('.web-world')!.style.width;
    size = { width: 0, height: 0 };
    await act(async () => { resizeObservers.forEach(tell => tell()); });
    expect(document.querySelector<HTMLElement>('.web-world')!.style.width).toBe(before);
    size = { width: 900, height: 540 };
    await act(async () => { resizeObservers.forEach(tell => tell()); });
    expect(document.querySelector<HTMLElement>('.web-world')!.style.width).toBe(before);
  });

  it('leaves a wheel over an open card to the card', async () => {
    await render();
    await openCard();
    const event = await wheel({ deltaY: -40 }, document.querySelector(cardSelector)!);
    expect(event.defaultPrevented).toBe(false);
  });
}

describe('the similarity map', () => {
  const center = layoutSimilarWeb(similarWeb, 900, 540)[0];
  const extra = (n: number, base: Partial<WebNode>): WebNode => ({ ...center, isCenter: false, id: `n${n}`, name: `Node ${n}`, x: 450 + 60 * Math.cos(n), y: 270 + 60 * Math.sin(n), similarity: .8, rank: n, reasons: [], ...base });
  const web: SimilarWeb = similarWeb;
  const nodes = (width: number, height: number) => [
    ...layoutSimilarWeb(web, width, height),
    extra(90, { name: 'Found Nearby', via: { id: center.id, name: center.name }, discoveryZoom: 1, listeners: 4200 }),
    extra(91, { kind: 'song', name: 'A Song', subtitle: 'The Singer' }),
    extra(92, { name: 'Same Spot', x: 450, y: 270 }),
  ];
  const nearMany = () => Array.from({ length: 7 }, (_, i) => `Friend ${i}`);
  const render = (props: Partial<Parameters<typeof ConnectionWebCanvas>[0]> = {}) => show(
    <ConnectionWebCanvas nodes={nodes} edges={[...buildWebEdges(web), { from: center.id, to: 'n92', kind: 'similarity', strength: .5 }, { from: center.id, to: 'nowhere', kind: 'similarity', strength: 1 }]}
      near={nearMany} actions={() => <button>Act</button>} onVisibleCount={vi.fn()} onExplore={vi.fn()} levelOfDetail {...props} />);
  const card = (name: string) => act(async () => { document.querySelector<HTMLButtonElement>(`[aria-label$=": ${name}"]`)!.click(); });

  sharedCases(() => render(), '.web-info-card', () => card('Found Nearby'));

  it('explains the center, a find from zooming in, a song, and many connections', async () => {
    await render();
    await card(center.name);
    expect(document.querySelector('.web-info-card')!.textContent).toContain('Everything on this map is placed by how similar it is to this artist.');
    await card('Found Nearby');
    const text = document.querySelector('.web-info-card')!.textContent!;
    for (const expected of ['to ' + center.name, 'Found by zooming in near', '4,200 listeners on ListenBrainz', 'and 2 more']) expect(text).toContain(expected);
    await card('A Song');
    expect(document.querySelector('.web-info-card')!.textContent).toContain('by The Singer');
  });

  it('leaves out closeness when asked, and starts a friends map from where it’s told, even unmeasured', async () => {
    size = { width: 0, height: 0 };
    const startAt = vi.fn((width: number) => ({ x: -width / 10, y: 0, zoom: 1 }));
    await render({ showCloseness: false, startAt });
    expect(startAt).toHaveBeenCalledWith(900);
    await card('Found Nearby');
    expect(document.querySelector('.web-info-meter')).toBeNull();
  });
});

describe('the Comparison map', () => {
  const graph = () => buildConnectionWeb({ mode: 'comparison', a: oliviaDetails, b: taylorDetails, collab }, [], ['pop']);
  const props = { onSelect: vi.fn(), onExplore: vi.fn(), onLevelChange: vi.fn(), onVisibleCount: vi.fn() };
  const render = (data = graph()) => show(<ComparisonWebCanvas graph={data} {...props} />);
  const line = () => document.querySelector<SVGPathElement>('.web-line-hit')!;

  sharedCases(() => render(), '.web-edge-card', async () => { await act(async () => { line().dispatchEvent(new MouseEvent('click', { bubbles: true })); }); });

  it('opens a line’s card from the keyboard, and closes it', async () => {
    await render();
    await act(async () => { line().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); });
    expect(document.querySelector('.web-edge-card')).toBeNull();
    await act(async () => { line().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    expect(document.querySelector('.web-edge-card')).not.toBeNull();
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Close connection details"]')!.click(); });
    await act(async () => { line().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(document.querySelector('.web-edge-card')).not.toBeNull();
  });

  it('explores around the artist under the wheel once a zoom-in settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render();
    const artist = document.querySelector<HTMLElement>('.web-artist')!;
    await wheel({ deltaY: -200, clientX: parseFloat(artist.style.left), clientY: parseFloat(artist.style.top) });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(props.onExplore).toHaveBeenCalled();
    await wheel({ deltaY: 200 });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(props.onLevelChange).toHaveBeenCalled();
  });

  it('says when there are no credited artists', async () => {
    await render({ ...graph(), nodes: [], edges: [], path: [] });
    expect(document.querySelector('.web-map-empty')!.textContent).toContain('No credited artists found');
  });
});

describe('both maps’ remaining cases', () => {
  const center = layoutSimilarWeb(similarWeb, 900, 540)[0];
  const sourced = { kind: 'listeners' as const, text: 'Played together.', sourceUrl: 'https://listenbrainz.org/x' };
  const node = (n: number, extra: Partial<WebNode> = {}): WebNode => ({ ...center, isCenter: false, id: `m${n}`, name: `Map ${n}`, x: 300 + n * 70, y: 270, similarity: .9, rank: n, reasons: [sourced], ...extra });
  const similarity = (props: Partial<Parameters<typeof ConnectionWebCanvas>[0]> = {}) => show(
    <ConnectionWebCanvas nodes={() => [center, node(1, { group: 'shared' }), node(2), node(3)]} edges={[{ from: 'm1', to: 'm2', kind: 'similar', strength: 1 }]}
      near={() => ['One', 'Two']} actions={() => null} onVisibleCount={vi.fn()} {...props} />);
  const artist = (name: string) => document.querySelector<HTMLButtonElement>(`[aria-label$=": ${name}"]`)!;
  const hover = (el: Element, on = true) => act(async () => { el.dispatchEvent(new MouseEvent(on ? 'pointerover' : 'pointerout', { bubbles: true })); });

  it('the similarity map previews on hover, keeps a pinned card while panning, and unpins on Escape or a press on the background', async () => {
    await similarity();
    await hover(artist('Map 2'));
    expect(document.querySelector('.web-info-card.is-preview')).not.toBeNull();
    expect(document.querySelector('.web-info-card a')).toBeNull(); // no source links in a preview
    expect(document.querySelector('.web-info-card')!.textContent).toContain('Also connected to One, Two.');
    await hover(artist('Map 2'), false);
    await act(async () => { artist('Map 1').click(); });
    expect(document.querySelector('.web-info-card a')).not.toBeNull();
    await pointer('pointerdown', 100, 100);
    await pointer('pointermove', 200, 100);
    expect(document.querySelector('.web-info-card')!.textContent).toContain('Map 1');
    await pointer('pointerup', 200, 100);
    await key('Escape');
    expect(document.querySelector('.web-info-card')).toBeNull();
    await act(async () => { artist('Map 1').click(); });
    await pointer('pointerdown', 10, 10, { target: artist('Map 3') });
    await pointer('pointerup', 10, 10, { target: artist('Map 3') });
    expect(document.querySelector('.web-info-card')).not.toBeNull(); // a press on an artist doesn't unpin
    await pointer('pointerdown', 10, 10);
    await pointer('pointerup', 10, 10);
    expect(document.querySelector('.web-info-card')).toBeNull();
  });

  it('the similarity map colours playlist groups, says when it’s empty, and drops lines to artists panned away', async () => {
    await similarity({ empty: true });
    expect(artist('Map 1').className).toContain('group-shared');
    expect(document.querySelector('.web-map-note')!.textContent).toContain('Nothing to compare yet');
    for (let i = 0; i < 40; i++) await key('ArrowLeft');
    expect(document.querySelector('.web-line')).toBeNull();
  });

  it('both maps follow a new size', async () => {
    await similarity();
    size = { width: 1200, height: 700 };
    await act(async () => { resizeObservers.forEach(tell => tell()); });
    expect(document.querySelector<HTMLElement>('.web-world')!.style.width).toBe('1200px');
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement('div')));
    size = { width: 900, height: 540 };
    const graph = buildConnectionWeb({ mode: 'comparison', a: oliviaDetails, b: taylorDetails, collab }, [], ['pop']);
    await show(<ComparisonWebCanvas graph={graph} onSelect={vi.fn()} onExplore={vi.fn()} onLevelChange={vi.fn()} onVisibleCount={vi.fn()} />);
    size = { width: 1200, height: 700 };
    await act(async () => { resizeObservers.forEach(tell => tell()); });
    expect(document.querySelector<HTMLElement>('.web-world')!.style.width).toBe('1200px');
  });

  it('the Comparison map dims lines away from a hovered artist, draws lines off the path, and resets mid-gesture', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const base = buildConnectionWeb({ mode: 'comparison', a: oliviaDetails, b: taylorDetails, collab }, [], ['pop']);
    const [first, second] = base.nodes;
    const graph = { ...base, edges: [...base.edges, { ...base.edges[0], from: first.id, to: first.id, onPath: false, label: 'Itself', detail: 'A line to itself.' }, { ...base.edges[0], from: second.id, to: first.id, onPath: false, label: 'Off path', detail: 'Not on the path.' }] };
    const onLevelChange = vi.fn();
    await show(<ComparisonWebCanvas graph={graph} onSelect={vi.fn()} onExplore={vi.fn()} onLevelChange={onLevelChange} onVisibleCount={vi.fn()} />);
    expect(document.querySelectorAll('.web-line:not(.on-path)').length).toBeGreaterThan(0);
    const third = [...document.querySelectorAll('.web-artist')].find(a => ![first.id, second.id].includes(a.getAttribute('data-artist-id')!));
    if (third) {
      await hover(third);
      expect(document.querySelectorAll('.web-line.muted').length).toBeGreaterThan(0);
      await hover(third, false);
    }
    await hover(document.querySelector('.web-artist')!);
    await hover(document.querySelector('.web-artist')!, false);
    await wheel({ deltaY: -100 });
    await key('0'); // resetting cancels the zoom's pending discovery
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(onLevelChange).toHaveBeenLastCalledWith(0);
  });
});

describe('focus, native drags and closing cards', () => {
  it('previews an artist on focus, refuses the browser’s own drag, and closes a pinned card', async () => {
    const center = layoutSimilarWeb(similarWeb, 900, 540)[0];
    await show(<ConnectionWebCanvas nodes={(w, h) => layoutSimilarWeb(similarWeb, w, h)} edges={[]} near={() => []} actions={() => null} onVisibleCount={vi.fn()} />);
    const node = document.querySelector<HTMLButtonElement>(`[aria-label="Selected: ${center.name}"]`)!;
    await act(async () => { node.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
    expect(document.querySelector('.web-info-card.is-preview')).not.toBeNull();
    await act(async () => { node.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    await act(async () => { map().dispatchEvent(drag); });
    expect(drag.defaultPrevented).toBe(true);
    await act(async () => { node.click(); });
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Close explanation"]')!.click(); });
    expect(document.querySelector('.web-info-card')).toBeNull();
  });

  it('highlights an artist on the Comparison map while it has focus', async () => {
    const graph = buildConnectionWeb({ mode: 'comparison', a: oliviaDetails, b: taylorDetails, collab }, [], ['pop']);
    await show(<ComparisonWebCanvas graph={graph} onSelect={vi.fn()} onExplore={vi.fn()} onLevelChange={vi.fn()} onVisibleCount={vi.fn()} />);
    const artist = document.querySelector('.web-artist')!;
    await act(async () => { artist.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
    await act(async () => { artist.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(document.querySelector('.web-line.muted')).toBeNull();
  });
});
