import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Expand, Minus, Plus, X } from 'lucide-react';
import type { DiscoveryFocus, WebGraph } from '../connection-web';
import { positionWebInViewport } from '../connection-web';
import { graphEdgeKey } from '../graph-layout';
import type { GraphNode } from '../graph-layout';
import type { Selection } from '../types';
import { focusArtistAt, initialWebCamera, interpolateWebZoom, MAX_WEB_ZOOM, MIN_WEB_ZOOM, scopeForZoom, webArtistCenter, zoomWebCamera } from '../web-navigation';
import type { WebCamera } from '../web-navigation';
import { ArtistAvatar } from './Artwork';
import { buildWebDetailIndex, isWebArtistInViewport, presentWebDetail } from '../web-detail';
import type { WebDetailIndex } from '../web-detail';

export function ConnectionWebCanvas({ graph: incomingGraph, onSelect, onLevelChange, onExplore, onVisibleCount, status }: { graph: WebGraph; onSelect: (s: Selection) => void; onLevelChange: (level: number) => void; onExplore: (focus: DiscoveryFocus, zoom: number) => void; onVisibleCount: (count: number) => void; status?: ReactNode }) {
  const [gestureGraph, setGestureGraph] = useState<WebGraph | null>(null);
  const [panning, setPanning] = useState(false);
  const graph = gestureGraph ?? incomingGraph;
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; camera: WebCamera; pointer: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const camera = useRef(initialWebCamera());
  const frame = useRef<number | null>(null);
  const motion = useRef<{ target: number; direction: number } | null>(null);
  const scopeCallback = useRef(onLevelChange);
  const exploreCallback = useRef(onExplore);
  const pointLookup = useRef<GraphNode[]>([]);
  const scopeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [size, setSize] = useState({ width: 900, height: 540 });
  const [view, setView] = useState(initialWebCamera);
  const [focus, setFocus] = useState<DiscoveryFocus | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [edgeKey, setEdgeKey] = useState<string | null>(null);
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
    cancelFrame(); setView(camera.current); setPanning(false); setGestureGraph(null);
    if (current.moved) suppressClick.current = true;
    if (canvas.current?.hasPointerCapture?.(current.pointer)) canvas.current.releasePointerCapture(current.pointer);
  }, [cancelFrame]);
  useEffect(() => {
    window.addEventListener('blur', finishDrag);
    return () => { window.removeEventListener('blur', finishDrag); cancelFrame(); };
  }, [finishDrag, cancelFrame]);
  useEffect(() => { scopeCallback.current = onLevelChange; }, [onLevelChange]);
  useEffect(() => { exploreCallback.current = onExplore; }, [onExplore]);
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
      if ((event.target as Element).closest('.web-edge-card')) return;
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
      const focus = focusArtistAt(pointLookup.current, focal, current);
      const direction = event.deltaY < 0 ? 1 : -1;
      const baseZoom = motion.current?.direction === direction ? motion.current.target : current.zoom;
      const next = zoomCamera(baseZoom * Math.exp(-event.deltaY * multiplier * (event.ctrlKey ? .006 : .0015)), focal);
      if (drag.current) drag.current.camera = { x: drag.current.camera.x + next.x - current.x, y: drag.current.camera.y + next.y - current.y, zoom: next.zoom };
      if (scopeTimer.current) clearTimeout(scopeTimer.current);
      // Update discovery after a wheel gesture settles, without restarting the camera.
      setFocus(focus);
      scopeTimer.current = setTimeout(() => { scopeCallback.current(scopeForZoom(next.zoom)); if (focus && event.deltaY < 0 && next.zoom >= 1.3) exploreCallback.current(focus, next.zoom); }, 140);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { element.removeEventListener('wheel', wheel); if (scopeTimer.current) clearTimeout(scopeTimer.current); };
  }, [queueCamera, zoomCamera]);
  // Camera state survives catalog updates. Only choosing different music remounts this canvas.
  const panBy = (x: number, y: number) => { finishDrag(); writeCamera({ ...camera.current, x: camera.current.x + x, y: camera.current.y + y }); };
  const changeZoom = (direction: number) => {
    finishDrag();
    if (scopeTimer.current) clearTimeout(scopeTimer.current);
    const current = camera.current;
    const baseZoom = motion.current?.direction === Math.sign(direction) ? motion.current.target : current.zoom;
    const next = zoomCamera(baseZoom * (direction > 0 ? 1.35 : 1 / 1.35), { x: size.width / 2, y: size.height / 2 });
    onLevelChange(scopeForZoom(next.zoom));
    const focus = focusArtistAt(pointLookup.current, { x: size.width / 2, y: size.height / 2 }, current);
    setFocus(focus);
    if (focus && direction > 0 && next.zoom >= 1.3) onExplore(focus, next.zoom);
  };
  const reset = () => { finishDrag(); if (scopeTimer.current) clearTimeout(scopeTimer.current); writeCamera(initialWebCamera()); onLevelChange(0); setFocus(null); setEdgeKey(null); };
  const layoutKey = `spatial-v2:${size.width}:${size.height}:${graph.nodes.map(n => `${n.id}:${n.role || ''}`).join('|')}:${graph.path.join('|')}`;
  const [layout, setLayout] = useState<{ key: string; width: number; height: number; nodes: GraphNode[]; index: WebDetailIndex | null }>({ key: '', width: 0, height: 0, nodes: [], index: null });
  let positions = layout.nodes;
  let detailIndex = layout.index;
  if (layout.key !== layoutKey) {
    positions = positionWebInViewport(graph, size.width, size.height, layout.width === size.width && layout.height === size.height ? layout.nodes : []);
    detailIndex = buildWebDetailIndex(positions, graph.path, size.width, size.height, layout.index);
    setLayout({ key: layoutKey, ...size, nodes: positions, index: detailIndex });
  }
  const allNodes = useMemo(() => {
    const coordinates = new Map(positions.map(n => [n.id, n]));
    return graph.nodes.map(n => ({ ...n, x: coordinates.get(n.id)!.x, y: coordinates.get(n.id)!.y }));
  }, [graph.nodes, positions]);
  const presentation = useMemo(() => presentWebDetail(allNodes, graph.path, { ...size, camera: view, focus, index: detailIndex! }), [allNodes, graph.path, size, view, focus, detailIndex]);
  const visibleNodes = useMemo(() => presentation.filter(item => item.opacity > .5 && isWebArtistInViewport(item.node, { ...size, camera: view })).map(item => item.node), [presentation, size, view]);
  useEffect(() => { pointLookup.current = visibleNodes; }, [visibleNodes]);
  useEffect(() => { onVisibleCount(visibleNodes.length); }, [visibleNodes.length, onVisibleCount]);
  const edge = graph.edges.find(e => graphEdgeKey(e) === edgeKey);
  const lookup = new Map(allNodes.map(n => [n.id, n]));

  return <div className="web-map" ref={canvas} tabIndex={0} data-panning={panning || undefined} aria-label="Artist connection map. Drag to pan in any direction. Scroll to zoom. Use arrow keys to move, plus or minus to zoom, and zero to reset. Select an artist to open details."
    onKeyDown={e => {
      if (e.key === 'Escape') { finishDrag(); setEdgeKey(null); return; }
      if (e.target !== e.currentTarget) return;
      const moves: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
      if (moves[e.key]) { e.preventDefault(); panBy(...moves[e.key]); }
      if (['+', '=', '-', '0'].includes(e.key)) { e.preventDefault(); if (e.key === '0') reset(); else changeZoom(e.key === '-' ? -1 : 1); }
    }}
    onPointerDown={e => {
      if (e.button !== 0 || e.isPrimary === false || drag.current || (e.target as Element).closest('.web-map-controls, .web-map-status, .web-edge-card, a, [data-web-edge]')) return;
      suppressClick.current = false; setGestureGraph(incomingGraph);
      writeCamera(camera.current);
      drag.current = { x: e.clientX, y: e.clientY, camera: camera.current, pointer: e.pointerId, moved: false };
      if (!(e.target as Element).closest('.web-artist')) { e.currentTarget.focus({ preventScroll: true }); e.currentTarget.setPointerCapture?.(e.pointerId); }
    }}
    onPointerMove={e => {
      const current = drag.current;
      if (!current || current.pointer !== e.pointerId) return;
      if (!current.moved && Math.hypot(e.clientX - current.x, e.clientY - current.y) < 4) return;
      if (!current.moved) { e.currentTarget.focus({ preventScroll: true }); setPanning(true); setHover(null); setEdgeKey(null); }
      current.moved = true; e.currentTarget.setPointerCapture?.(e.pointerId);
      queueCamera({ ...current.camera, x: current.camera.x + e.clientX - current.x, y: current.camera.y + e.clientY - current.y });
    }}
    onPointerUp={e => {
      if (!drag.current || drag.current.pointer !== e.pointerId) return;
      if (drag.current.moved) e.preventDefault(); else setEdgeKey(null);
      finishDrag();
    }}
    onClickCapture={e => { if (suppressClick.current && e.detail > 0) { e.preventDefault(); e.stopPropagation(); } suppressClick.current = false; }}
    onDragStart={e => e.preventDefault()} onPointerCancel={e => { if (drag.current?.pointer === e.pointerId) finishDrag(); }} onLostPointerCapture={e => { if (drag.current?.pointer === e.pointerId) finishDrag(); }}>
    <div className="web-map-grid" style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${25 * view.zoom}px ${25 * view.zoom}px` }} />
    <div className="web-world" style={{ width: size.width, height: size.height, left: 0, top: 0,
      transform: `translate3d(${view.x}px, ${view.y}px, 0)`, '--web-node-width': `${graph.nodeWidth}px` } as CSSProperties}>
      <svg className="web-lines" viewBox={`0 0 ${size.width} ${size.height}`} aria-label="Artist relationships">
        {graph.edges.map(connection => {
          const from = lookup.get(connection.from)!, to = lookup.get(connection.to)!;
          const a = { ...from, ...webArtistCenter(from, { x: 0, y: 0, zoom: view.zoom }) }, b = { ...to, ...webArtistCenter(to, { x: 0, y: 0, zoom: view.zoom }) };
          const key = graphEdgeKey(connection), length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const dx = (b.x - a.x) / length * 40, dy = (b.y - a.y) / length * 40;
          const d = `M ${a.x + dx} ${a.y + dy} L ${b.x - dx} ${b.y - dy}`;
          const label = `${a.label} and ${b.label}: ${connection.label}. ${connection.detail ?? ''}`;
          return <g key={key} className={`web-line ${connection.category} ${connection.onPath ? 'on-path' : ''} ${hover && ![connection.from, connection.to].includes(hover) ? 'muted' : ''} ${edgeKey === key ? 'selected' : ''}`}>
            <path d={d} className="web-line-visible" vectorEffect="non-scaling-stroke" />
            <path d={d} data-web-edge={key} className="web-line-hit" stroke="transparent" strokeWidth={16} vectorEffect="non-scaling-stroke" role="button" tabIndex={0}
              aria-label={label} aria-pressed={edgeKey === key} onClick={() => setEdgeKey(key)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEdgeKey(key); } }}><title>{label}</title></path>
          </g>;
        })}
      </svg>
      {presentation.map(({ node, opacity }) => {
        const point = webArtistCenter(node, { x: 0, y: 0, zoom: view.zoom });
        const inView = opacity > .5 && isWebArtistInViewport(node, { ...size, camera: view });
        return <button key={node.id} className={`web-artist ${opacity > 0 ? 'is-shown' : 'is-hidden'} ${node.role ? 'anchor' : ''} ${node.contributor ? 'contributor' : ''}`}
        style={{ left: point.x, top: point.y + (node.role ? 22 : 25), '--web-artist-opacity': opacity, pointerEvents: opacity > .1 ? undefined : 'none' } as CSSProperties} tabIndex={inView ? 0 : -1} data-artist-id={node.id} data-world-x={node.x} data-world-y={node.y - 22} data-detail-opacity={opacity} data-in-viewport={inView || undefined} aria-label={`View artist: ${node.label}`} title={panning ? undefined : `${node.label} · ${node.detail || node.subtitle}`}
        onPointerEnter={() => { if (!drag.current?.moved) setHover(node.id); }} onPointerLeave={() => { if (!drag.current?.moved) setHover(null); }} onFocus={() => setHover(node.id)} onBlur={() => setHover(null)}
        onClick={() => onSelect({ type: 'artist', id: node.id })}>
        <span className="web-avatar"><ArtistAvatar artist={{ id: node.id, name: node.label, artUrl: node.artUrl }} />{node.role && <span className="web-anchor-dot" />}</span>
        <strong>{node.label}</strong><small>{node.subtitle}</small>
      </button>; })}
    </div>
    {!graph.nodes.length && <div className="web-map-empty"><strong>No credited artists found</strong><p>Choose another song to discover its musical neighborhood.</p></div>}
    {status}
    <div className="web-map-controls"><button className="icon-button" aria-label="Zoom out" title="Discover more diverse artists" disabled={view.zoom <= MIN_WEB_ZOOM} onClick={() => changeZoom(-1)}><Minus size={16} /></button><output aria-label="Map zoom">{Math.round(view.zoom * 100)}%</output><button className="icon-button" aria-label="Zoom in" title="Reveal more artists in this area" disabled={view.zoom >= MAX_WEB_ZOOM} onClick={() => changeZoom(1)}><Plus size={16} /></button><span /><button className="icon-button" aria-label="Fit connection map" title="Reset exploration" onClick={reset}><Expand size={16} /></button></div>
    {edge && <div className="web-edge-card" role="region" aria-label="Connection details"><button className="icon-button" aria-label="Close connection details" onClick={() => setEdgeKey(null)}><X size={15} /></button><small>DOCUMENTED CREDIT</small><strong>{lookup.get(edge.from)?.label} & {lookup.get(edge.to)?.label}</strong><p>{edge.detail}</p><div>{edge.sourceUrls?.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer">Source {i + 1} ↗</a>)}</div></div>}
  </div>;
}
