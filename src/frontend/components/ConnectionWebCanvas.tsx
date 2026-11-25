import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowUpRight, Expand, Minus, Plus, X } from 'lucide-react';
import { closenessLabel, nodeOpacity } from '../similar-web';
import type { WebEdge, WebNode } from '../similar-web';
import { buildWebDetailIndex, focusAt, webDetailOpacity } from '../similar-detail';
import type { WebDetailIndex, WebFocus } from '../similar-detail';
import { initialWebCamera, interpolateWebZoom, MAX_WEB_ZOOM, MIN_WEB_ZOOM, webArtistCenter, worldToWebScreen, zoomWebCamera } from '../web-navigation';
import type { WebCamera } from '../web-navigation';
import { AlbumCover, ArtistAvatar } from './Artwork';

const OVERSCAN = 180;
/** Zooming in this far near an artist asks for more around it. */
export const EXPLORE_ZOOM = 1.3;
/** From an avatar's center to the middle of its card, and to its edge. */
const cardOffset = (node: WebNode) => (node.isCenter ? 22 : 19);
const avatarReach = (node: WebNode) => (node.isCenter ? 40 : 28);
const inViewport = (point: { x: number; y: number }, size: { width: number; height: number }, padding = 0) =>
  point.x >= -padding && point.x <= size.width + padding && point.y >= -padding && point.y <= size.height + padding;

type CanvasProps = {
  /** Where everything goes for a given map size. Keep it stable between renders. */
  nodes: (width: number, height: number) => WebNode[];
  edges: WebEdge[];
  /** Names directly connected to this one, for the explanation card. */
  near: (id: string) => string[];
  /** Buttons on a pinned explanation. */
  actions: (node: WebNode) => ReactNode;
  /** Whether nodes have a similarity to show. */
  showCloseness?: boolean;
  /** Where the camera starts, for maps wider than the view. */
  startAt?: (width: number) => WebCamera;
  /** Helen's zoom-dependent detail: a small, varied set zoomed out, more the closer you get. Otherwise the closest few always show. */
  levelOfDetail?: boolean;
  /** Called once a zoom-in near an artist settles, to load more around it. */
  onExplore?: (nodeId: string, zoom: number) => void;
  onVisibleCount: (count: number) => void;
  status?: ReactNode;
  empty?: boolean;
};

export function ConnectionWebCanvas({ nodes: placeNodes, edges, near: nearOf, actions, showCloseness = true, startAt, levelOfDetail = false, onExplore, onVisibleCount, status, empty }: CanvasProps) {
  const [panning, setPanning] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; camera: WebCamera; pointer: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const camera = useRef(initialWebCamera());
  const frame = useRef<number | null>(null);
  const motion = useRef<{ target: number; direction: number } | null>(null);
  const exploreCallback = useRef(onExplore);
  const shownNodes = useRef<WebNode[]>([]);
  const exploreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [size, setSize] = useState({ width: 900, height: 540 });
  const [view, setView] = useState(initialWebCamera);
  const [focus, setFocus] = useState<WebFocus | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const cancelFrame = useCallback(() => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; motion.current = null; }, []);
  const writeCamera = useCallback((next: WebCamera) => { cancelFrame(); camera.current = next; setView(next); }, [cancelFrame]);
  const queueCamera = useCallback((next: WebCamera) => {
    if (motion.current) cancelFrame();
    camera.current = next;
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setView(camera.current); });
  }, [cancelFrame]);
  const zoomCamera = useCallback((zoom: number, focal: { x: number; y: number }) => {
    const start = camera.current, target = zoomWebCamera(start, zoom, focal);
    cancelFrame();
    if (target.zoom === start.zoom || drag.current || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      camera.current = target; setView(target); return target;
    }
    const animation = { target: target.zoom, direction: Math.sign(target.zoom - start.zoom) }; motion.current = animation;
    const started = performance.now();
    const tick = (now: number) => {
      if (motion.current !== animation) return;
      const progress = Math.min(1, Math.max(0, (now - started) / 180));
      const next = interpolateWebZoom(start, target.zoom, focal, progress);
      camera.current = next; setView(next);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else { frame.current = null; motion.current = null; }
    };
    frame.current = requestAnimationFrame(tick);
    return target;
  }, [cancelFrame]);
  const finishDrag = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    cancelFrame(); setView(camera.current); setPanning(false);
    if (current.moved) suppressClick.current = true;
    if (canvas.current?.hasPointerCapture?.(current.pointer)) canvas.current.releasePointerCapture(current.pointer);
  }, [cancelFrame]);
  useEffect(() => {
    window.addEventListener('blur', finishDrag);
    return () => { window.removeEventListener('blur', finishDrag); cancelFrame(); };
  }, [finishDrag, cancelFrame]);
  useEffect(() => { exploreCallback.current = onExplore; }, [onExplore]);
  useEffect(() => () => { if (exploreTimer.current) clearTimeout(exploreTimer.current); }, []);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const resize = () => { const { width, height } = element.getBoundingClientRect(); if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height }); };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('.web-info-card')) return;
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height || 500 : 1;
      const current = camera.current;
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const next = { ...current, x: current.x - (event.deltaX || event.deltaY) * multiplier };
        if (drag.current) drag.current.camera = { ...drag.current.camera, x: drag.current.camera.x + next.x - current.x };
        queueCamera(next);
        return;
      }
      if (!event.deltaY) return;
      const focal = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      element.focus({ preventScroll: true });
      const direction = event.deltaY < 0 ? 1 : -1;
      const baseZoom = motion.current?.direction === direction ? motion.current.target : current.zoom;
      // The artist under the pointer, measured before the camera moves.
      const nextFocus = focusAt(shownNodes.current, focal, current);
      const next = zoomCamera(baseZoom * Math.exp(-event.deltaY * multiplier * (event.ctrlKey ? .006 : .0015)), focal);
      if (drag.current) drag.current.camera = { x: drag.current.camera.x + next.x - current.x, y: drag.current.camera.y + next.y - current.y, zoom: next.zoom };
      setFocus(nextFocus);
      // Explore once the wheel gesture settles, without restarting the camera.
      if (exploreTimer.current) clearTimeout(exploreTimer.current);
      exploreTimer.current = setTimeout(() => { if (direction > 0 && next.zoom >= EXPLORE_ZOOM && nextFocus.nodeId) exploreCallback.current?.(nextFocus.nodeId, next.zoom); }, 140);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [queueCamera, zoomCamera]);
  const panBy = (x: number, y: number) => { finishDrag(); writeCamera({ ...camera.current, x: camera.current.x + x, y: camera.current.y + y }); };
  const changeZoom = (direction: number) => {
    finishDrag();
    if (exploreTimer.current) clearTimeout(exploreTimer.current);
    const middle = { x: size.width / 2, y: size.height / 2 };
    const nextFocus = focusAt(shownNodes.current, middle, camera.current);
    const baseZoom = motion.current?.direction === Math.sign(direction) ? motion.current.target : camera.current.zoom;
    const next = zoomCamera(baseZoom * (direction > 0 ? 1.35 : 1 / 1.35), middle);
    setFocus(nextFocus);
    if (direction > 0 && next.zoom >= EXPLORE_ZOOM && nextFocus.nodeId) onExplore?.(nextFocus.nodeId, next.zoom);
  };
  const start = useCallback((width: number) => startAt?.(width) ?? initialWebCamera(), [startAt]);
  const reset = () => { finishDrag(); if (exploreTimer.current) clearTimeout(exploreTimer.current); writeCamera(start(size.width)); setPinned(null); setFocus(null); };
  useEffect(() => { if (startAt) writeCamera(start(canvas.current?.getBoundingClientRect().width || 900)); }, [startAt, start, writeCamera]);

  const nodes = useMemo(() => placeNodes(size.width, size.height), [placeNodes, size.width, size.height]);
  const lookup = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  // Detail cells are rebuilt only when the map changes, keeping earlier members where they were.
  const detailKey = levelOfDetail ? `${size.width}:${size.height}:${nodes.map(n => n.id).join('|')}` : '';
  const [detail, setDetail] = useState<{ key: string; index: WebDetailIndex | null }>({ key: '', index: null });
  let detailIndex = detail.index;
  if (levelOfDetail && detail.key !== detailKey) {
    detailIndex = buildWebDetailIndex(nodes, size.width, size.height, detail.index);
    setDetail({ key: detailKey, index: detailIndex });
  }
  const tiers = useMemo(() => levelOfDetail && detailIndex ? webDetailOpacity(nodes, { ...size, camera: view, focus, index: detailIndex }) : null, [levelOfDetail, nodes, size, view, focus, detailIndex]);
  // Everything the map showed before still shows; Helen's tiers add artists found by zooming in as you get close.
  const shownAt = (node: WebNode) => node.discoveryZoom ? tiers?.get(node.id) ?? 0 : Math.max(nodeOpacity(node, view.zoom), tiers?.get(node.id) ?? 0);
  const present = nodes.map(node => ({ node, opacity: shownAt(node), screen: worldToWebScreen(node, view) }))
    .filter(item => item.node.isCenter || inViewport(item.screen, size, OVERSCAN));
  const opacity = new Map(present.map(item => [item.node.id, item.opacity]));
  const onScreen = present.filter(item => item.opacity > .5 && inViewport(item.screen, size)).map(item => item.node);
  const visibleCount = onScreen.length;
  useEffect(() => { shownNodes.current = onScreen; });
  useEffect(() => { onVisibleCount(visibleCount); }, [visibleCount, onVisibleCount]);

  const focusId = hover ?? pinned;
  const card = (panning ? pinned : focusId) ? lookup.get((panning ? pinned : focusId)!) : undefined;
  const isPreview = !!card && card.id !== pinned;
  const near = card ? nearOf(card.id) : [];

  return <div className="web-map" ref={canvas} tabIndex={0} data-panning={panning || undefined} aria-label="Map of similar music. The closer something is to the center, the more similar it is. Drag to pan, scroll to zoom, arrow keys to move, plus or minus to zoom, zero to reset. Select anything to see why it's here."
    onKeyDown={e => {
      if (e.key === 'Escape') { finishDrag(); setPinned(null); return; }
      if (e.target !== e.currentTarget) return;
      const moves: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
      if (moves[e.key]) { e.preventDefault(); panBy(...moves[e.key]); }
      if (['+', '=', '-', '0'].includes(e.key)) { e.preventDefault(); if (e.key === '0') reset(); else changeZoom(e.key === '-' ? -1 : 1); }
    }}
    onPointerDown={e => {
      if (e.button !== 0 || e.isPrimary === false || drag.current || (e.target as Element).closest('.web-map-controls, .web-map-status, .web-info-card, a')) return;
      suppressClick.current = false;
      writeCamera(camera.current);
      drag.current = { x: e.clientX, y: e.clientY, camera: camera.current, pointer: e.pointerId, moved: false };
      if (!(e.target as Element).closest('.web-artist')) { e.currentTarget.focus({ preventScroll: true }); e.currentTarget.setPointerCapture?.(e.pointerId); }
    }}
    onPointerMove={e => {
      const current = drag.current;
      if (!current || current.pointer !== e.pointerId) return;
      if (!current.moved && Math.hypot(e.clientX - current.x, e.clientY - current.y) < 4) return;
      if (!current.moved) { e.currentTarget.focus({ preventScroll: true }); setPanning(true); setHover(null); }
      current.moved = true; e.currentTarget.setPointerCapture?.(e.pointerId);
      queueCamera({ ...current.camera, x: current.camera.x + e.clientX - current.x, y: current.camera.y + e.clientY - current.y });
    }}
    onPointerUp={e => {
      if (!drag.current || drag.current.pointer !== e.pointerId) return;
      if (drag.current.moved) e.preventDefault();
      else if (!(e.target as Element).closest('.web-artist')) setPinned(null);
      finishDrag();
    }}
    onClickCapture={e => { if (suppressClick.current && e.detail > 0) { e.preventDefault(); e.stopPropagation(); } suppressClick.current = false; }}
    onDragStart={e => e.preventDefault()} onPointerCancel={e => { if (drag.current?.pointer === e.pointerId) finishDrag(); }} onLostPointerCapture={e => { if (drag.current?.pointer === e.pointerId) finishDrag(); }}>
    <div className="web-map-grid" style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${25 * view.zoom}px ${25 * view.zoom}px` }} />
    <div className="web-world" style={{ width: size.width, height: size.height, left: 0, top: 0, transform: `translate3d(${view.x}px, ${view.y}px, 0)`, '--web-node-width': '96px' } as CSSProperties}>
      <svg className="web-lines" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
        {edges.map(edge => {
          const from = lookup.get(edge.from), to = lookup.get(edge.to);
          if (!from || !to || !Math.min(opacity.get(edge.from) ?? 0, opacity.get(edge.to) ?? 0)) return null;
          const scale = { x: 0, y: 0, zoom: view.zoom };
          const a = webArtistCenter(from, scale), b = webArtistCenter(to, scale);
          const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const d = `M ${a.x + (b.x - a.x) / length * avatarReach(from)} ${a.y + (b.y - a.y) / length * avatarReach(from)} L ${b.x - (b.x - a.x) / length * avatarReach(to)} ${b.y - (b.y - a.y) / length * avatarReach(to)}`;
          const touches = !!focusId && [edge.from, edge.to].includes(focusId);
          return <g key={`${edge.kind}:${edge.from}:${edge.to}`} style={{ '--web-line-strength': .12 + edge.strength * .4 } as CSSProperties} className={`web-line ${edge.kind} ${touches ? 'is-hovered' : ''} ${focusId && !touches ? 'muted' : ''}`}><path d={d} className="web-line-visible" vectorEffect="non-scaling-stroke" /></g>;
        })}
      </svg>
      {present.map(({ node, opacity: shown, screen }) => {
        const point = webArtistCenter(node, { x: 0, y: 0, zoom: view.zoom });
        const inView = shown > .5 && inViewport(screen, size);
        return <button key={node.id} className={`web-artist is-${node.kind} ${node.group ? `group-${node.group}` : ''} ${shown > 0 ? 'is-shown' : 'is-hidden'} ${node.isCenter ? 'anchor' : 'compact'} ${pinned === node.id ? 'is-pinned' : ''}`}
          style={{ left: point.x, top: point.y + cardOffset(node), '--web-artist-opacity': shown, pointerEvents: shown > .1 ? undefined : 'none' } as CSSProperties} tabIndex={inView ? 0 : -1} data-artist-id={node.id} data-similarity={node.similarity} data-in-viewport={inView || undefined} aria-label={`${node.isCenter ? 'Selected' : 'Why is this here'}: ${node.name}`} aria-pressed={pinned === node.id}
          onPointerEnter={() => { if (!drag.current?.moved) setHover(node.id); }} onPointerLeave={() => { if (!drag.current?.moved) setHover(null); }} onFocus={() => setHover(node.id)} onBlur={() => setHover(null)}
          onClick={() => setPinned(node.id)}>
          <span className="web-avatar">{node.kind === 'song' ? <AlbumCover cover={{ id: node.id, artUrl: node.imageUrl }} /> : <ArtistAvatar artist={{ id: node.id, name: node.name, artUrl: node.imageUrl }} />}{node.isCenter && <span className="web-anchor-dot" />}</span>
          <strong>{node.name}</strong><small>{node.subtitle}</small>
        </button>;
      })}
    </div>
    {empty && <div className="web-map-note"><strong>Nothing to compare yet</strong><p>The listening data doesn’t cover this one. Try something more widely played.</p></div>}
    {card && <div className={`web-info-card ${isPreview ? 'is-preview' : ''}`} role="region" aria-label={`Why ${card.name} is here`}>
      {!isPreview && <button className="icon-button web-info-close" aria-label="Close explanation" onClick={() => setPinned(null)}><X size={14} /></button>}
      <strong>{card.name}</strong>
      {card.subtitle && <small>{card.kind === 'song' ? `by ${card.subtitle}` : card.subtitle}</small>}
      {card.isCenter ? <small>Everything on this map is placed by how similar it is to this {card.kind}.</small>
        : showCloseness && <div className="web-info-meter" title={card.via ? `Calculated. Relative to the closest match to ${card.via.name}, not an absolute score.` : 'Calculated. Relative to the closest match on this map, not an absolute score.'}><span><i style={{ width: `${card.similarity * 100}%` }} /></span>{closenessLabel(card.similarity)}{card.via && ` to ${card.via.name}`}</div>}
      {card.via && <small>Found by zooming in near {card.via.name}.</small>}
      {!card.isCenter && <ul>{card.reasons.map(reason => <li key={reason.kind + reason.text}>{reason.text}{reason.sourceUrl && !isPreview && <> <a href={reason.sourceUrl} target="_blank" rel="noreferrer">Source <ArrowUpRight size={10} /></a></>}</li>)}</ul>}
      {card.listeners !== null && <small>{card.listeners.toLocaleString('en-US')} listeners on ListenBrainz (its own community, not all listeners)</small>}
      {near.length > 0 && <p className="web-info-near">Also connected to {near.slice(0, 5).join(', ')}{near.length > 5 ? ` and ${near.length - 5} more` : ''}.</p>}
      {!isPreview && <div className="web-info-actions">{actions(card)}</div>}
    </div>}
    {status}
    <div className="web-map-controls"><button className="icon-button" aria-label="Zoom out" disabled={view.zoom <= MIN_WEB_ZOOM} onClick={() => changeZoom(-1)}><Minus size={16} /></button><output aria-label="Map zoom">{Math.round(view.zoom * 100)}%</output><button className="icon-button" aria-label="Zoom in" disabled={view.zoom >= MAX_WEB_ZOOM} onClick={() => changeZoom(1)}><Plus size={16} /></button><span /><button className="icon-button" aria-label="Fit connection map" title="Reset" onClick={reset}><Expand size={16} /></button></div>
  </div>;
}
