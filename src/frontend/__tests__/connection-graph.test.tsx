// @vitest-environment jsdom
// Explore's interactive graph on its own: hovering and focusing people and lines, selecting a line
// for its sources, panning by keys and by dragging, zooming, showing more, and what it says when
// a role filter or the scan leaves nothing to draw.
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollaboratorComparison } from '@/lib/types';
import type { GraphInput } from '../graph';
import { collab, oliviaDetails, SERBAN, taylorDetails } from './fixtures';

vi.mock('../api', () => ({ artistDetails: vi.fn(() => new Promise(() => {})) }));
import { ConnectionGraph } from '../components/ConnectionGraph';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let size = { width: 900, height: 600 };
beforeEach(() => {
  size = { width: 900, height: 600 };
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Element.prototype.getBoundingClientRect = function () { return { ...size, left: 0, top: 0, right: size.width, bottom: size.height, x: 0, y: 0 } as DOMRect; };
  Element.prototype.setPointerCapture = () => {};
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const input = (extra: Partial<Extract<GraphInput, { kind: 'artist' }>> = {}): GraphInput =>
  ({ kind: 'artist', a: oliviaDetails, b: taylorDetails, collab, role: 'all', ...extra });
async function show(element: ReactElement) {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root!.render(element));
}
const render = (graph = input(), onSelect = vi.fn(), status?: string) => show(<ConnectionGraph input={graph} status={status} onSelect={onSelect} />);
const fire = (el: Element, event: Event) => act(async () => { el.dispatchEvent(event); });
const pointer = (type: string, x = 0, y = 0, button = 0) => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button }), { pointerId: 1 });
const canvas = () => document.querySelector<HTMLElement>('.graph-canvas')!;
const stage = () => document.querySelector<HTMLElement>('.graph-stage')!;
const node = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.graph-node')].find(n => n.textContent?.includes(label))!;
const lines = () => [...document.querySelectorAll<SVGPathElement>('.graph-link-hit')];
const named = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(name) || b.getAttribute('aria-label') === name)!;
const zoomText = () => document.querySelector('.graph-controls span')!.textContent;

describe('looking around the graph', () => {
  it('highlights a person and their lines on hover or focus, and only them', async () => {
    await render();
    const serban = node('Serban Ghenea');
    await fire(serban, pointer('pointerover'));
    await fire(serban, new FocusEvent('focusin', { bubbles: true }));
    expect(node('Dan Nigro').className).toContain('is-dimmed');
    expect(serban.className).not.toContain('is-dimmed');
    await fire(serban, new FocusEvent('focusout', { bubbles: true }));
    await fire(serban, pointer('pointerout'));
    expect(node('Dan Nigro').className).not.toContain('is-dimmed');
  });

  it('describes a line on hover or focus, and opens its sources when selected', async () => {
    await render();
    const line = lines()[0];
    await fire(line, pointer('pointerover'));
    expect(document.querySelector('[role="tooltip"]')!.textContent).toContain('Select connection for details');
    await fire(line, pointer('pointerout'));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await fire(line, new FocusEvent('focusin', { bubbles: true }));
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    await fire(line, new FocusEvent('focusout', { bubbles: true }));
    await fire(line, new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(document.querySelector('.graph-edge-selection')).toBeNull();
    await fire(line, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const panel = document.querySelector('.graph-edge-selection')!;
    expect(panel.textContent).toContain('Factual connection · documented relationship');
    expect(panel.querySelector('.graph-sources a')).not.toBeNull();
    await fire(named('Clear connection selection'), new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.graph-edge-selection')).toBeNull();
    await fire(lines().at(-1)!, new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await fire(lines()[1], new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.graph-edge-selection')).not.toBeNull();
  });

  it('calls a shared-genre line a calculated similarity', async () => {
    await render();
    const similar = lines().find(l => l.getAttribute('aria-label')!.startsWith('Musical similarity'))!;
    await fire(similar, pointer('pointerover'));
    expect(document.querySelector('[role="tooltip"]')!.textContent).toContain('Musical similarity · calculated');
    await fire(similar, new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.graph-edge-selection')!.textContent).toContain('Musical similarity · calculated from metadata');
  });

  it('selects a person, opens their details, shows the songs connecting them, and clears', async () => {
    const onSelect = vi.fn();
    await render(input(), onSelect);
    await fire(node('Serban Ghenea'), new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.graph-selection')!.textContent).toContain('Show the songs that connect them');
    await fire(named('View details'), new MouseEvent('click', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith({ type: 'artist', id: SERBAN });
    await fire(named('Show more'), new MouseEvent('click', { bubbles: true }));
    expect(document.querySelectorAll('.graph-node.is-song').length).toBeGreaterThan(0);
    await fire(named('Clear node selection'), new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.graph-selection')).toBeNull();
    await fire(node('Olivia Rodrigo'), new MouseEvent('click', { bubbles: true }));
    expect(named('Show more').disabled).toBe(true);
    await fire(named('Initial comparison'), new MouseEvent('click', { bubbles: true }));
    expect(document.querySelectorAll('.graph-node.is-song')).toHaveLength(0);
  });
});

describe('moving the view', () => {
  it('pans with the arrow keys only when the canvas itself has focus, and clears on Escape', async () => {
    await render();
    const before = stage().style.left;
    await fire(node('Olivia Rodrigo'), new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(stage().style.left).toBe(before);
    await fire(canvas(), new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(stage().style.left).not.toBe(before);
    for (const key of ['ArrowRight', 'ArrowUp', 'ArrowDown', 'Home']) await fire(canvas(), new KeyboardEvent('keydown', { key, bubbles: true }));
    await fire(node('Serban Ghenea'), new MouseEvent('click', { bubbles: true }));
    await fire(canvas(), new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.graph-selection')).toBeNull();
  });

  it('drags by the background, ignores other buttons and presses on people, and clears on a click', async () => {
    await render();
    const before = stage().style.left;
    await fire(canvas(), pointer('pointerdown', 100, 100, 2));
    await fire(canvas(), pointer('pointermove', 160, 100));
    expect(stage().style.left).toBe(before);
    await fire(node('Dan Nigro'), pointer('pointerdown', 100, 100));
    await fire(canvas(), pointer('pointermove', 160, 100));
    expect(stage().style.left).toBe(before);
    await fire(canvas(), pointer('pointerdown', 100, 100));
    await fire(canvas(), pointer('pointermove', 160, 100));
    expect(stage().style.left).not.toBe(before);
    await fire(canvas(), pointer('pointerup', 160, 100));
    await fire(node('Serban Ghenea'), new MouseEvent('click', { bubbles: true }));
    await fire(canvas(), pointer('pointerdown', 50, 50));
    await fire(canvas(), pointer('pointerup', 51, 50));
    expect(document.querySelector('.graph-selection')).toBeNull();
    await fire(canvas(), pointer('pointerdown', 50, 50));
    await fire(canvas(), pointer('pointercancel', 50, 50));
    await fire(canvas(), pointer('pointerdown', 50, 50));
    await fire(canvas(), pointer('lostpointercapture', 50, 50));
    await fire(canvas(), pointer('pointerup', 50, 50));
  });

  it('zooms within limits, resets, and fits again when the graph changes', async () => {
    await render();
    for (let i = 0; i < 8; i++) await fire(named('Zoom in'), new MouseEvent('click', { bubbles: true }));
    expect(zoomText()).toBe('240%');
    expect(named('Zoom in').disabled).toBe(true);
    await fire(named('Reset graph view'), new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 4; i++) await fire(named('Zoom out'), new MouseEvent('click', { bubbles: true }));
    expect(zoomText()).toBe('60%');
    expect(named('Zoom out').disabled).toBe(true);
    await fire(node('Serban Ghenea'), new MouseEvent('click', { bubbles: true }));
    await fire(named('Show more'), new MouseEvent('click', { bubbles: true }));
    expect(zoomText()).toBe('100%'); // a bigger graph is fitted afresh
  });

  it('uses narrower cards on a small screen', async () => {
    size = { width: 400, height: 500 };
    await render();
    expect(stage().style.getPropertyValue('--graph-node-width')).toBe('104px');
  });
});

describe('what the graph says', () => {
  const none: CollaboratorComparison = { ...collab, mutual: [], direct: { bOnA: [], aOnB: [] } };
  const noGenres = { ...taylorDetails, genres: [] };

  it('says loading, the role it shows, and that a role matches no one', async () => {
    await render(input({ role: 'producer' }), vi.fn(), 'Finding people…');
    expect(document.body.textContent).toContain('Finding people…');
    expect(document.body.textContent).toContain('Showing collaborators credited for producer. Your two artists stay visible.');
    await act(async () => root!.unmount());
    await render(input({ role: 'theremin', collab: none, b: noGenres }));
    expect(document.body.textContent).toContain('Showing collaborators credited for theremin.');
    expect(document.body.textContent).toContain('No collaborators match this role. Try All roles.');
  });

  it('says which songs’ collaborators a role shows', async () => {
    const { vampireDetails, opheliaDetails } = await import('./fixtures');
    await render({ kind: 'song', a: vampireDetails, b: opheliaDetails, collab, role: 'mixing' });
    expect(document.body.textContent).toContain('Your two songs stay visible.');
  });

  it('draws a songwriting credit alone as a dotted line', async () => {
    const writing = { ...collab, writing: { bOnA: [{ id: 'w', title: 'Written' }], aOnB: [] } };
    await render(input({ collab: writing, role: 'songwriting' }));
    expect(document.querySelector('.graph-link-line[stroke-dasharray="2 5"]')).not.toBeNull();
  });

  it('offers more collaborators from an artist when there are more than fit', async () => {
    const many = { ...collab, mutual: Array.from({ length: 9 }, (_, i) => ({ ...collab.mutual[0], id: `cc000000-0000-4000-8000-00000000010${i}`, name: `Person ${i}` })) };
    await render(input({ collab: many }));
    await fire(node('Olivia Rodrigo'), new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.graph-selection')!.textContent).toContain('More collaborators available');
  });

  it('says nothing was found for two songs with nothing in common', async () => {
    await render(input({ collab: none, b: noGenres }));
    expect(document.body.textContent).toContain('No documented connections found in the albums we scanned.');
  });
});
