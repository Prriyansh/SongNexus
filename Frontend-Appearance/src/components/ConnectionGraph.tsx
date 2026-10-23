import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowLeft, Expand, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { getArtist, getSong, makeCompareGraph } from '../data';
import type { EntityType, GenreFilter, GraphEdge } from '../data';
import { graphEdgeKey, graphFit, routeGraphEdges } from '../graph-layout';
import type { Selection } from '../types';
import { ArtistAvatar, AlbumCover } from './Artwork';

export function ConnectionGraph({ kind, left, right, filter, onSelect }: { kind: EntityType; left: string; right: string; filter: GenreFilter; onSelect: (s: Selection) => void }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 720, height: 520 });
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const graph = useMemo(() => makeCompareGraph(kind, left, right, filter, expanded, viewport.width < 500), [kind, left, right, filter, expanded, viewport.width < 500]);
  const routed = useMemo(() => routeGraphEdges(graph), [graph]);
  const lookup = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph]);
  const selectedEdge = graph.edges.find(e => graphEdgeKey(e) === selectedEdgeKey);
  const activeEdgeKey = hoveredId ? null : hoveredEdgeKey || selectedEdgeKey;
  const activeEdge = graph.edges.find(e => graphEdgeKey(e) === activeEdgeKey);
  const focusId = hoveredId || (!activeEdge ? selectedId : null);
  const highlighted = new Set<string>();
  if (activeEdge) { highlighted.add(activeEdge.from); highlighted.add(activeEdge.to); }
  else if (focusId) {
    highlighted.add(focusId);
    for (const edge of graph.edges) if (edge.from === focusId || edge.to === focusId) { highlighted.add(edge.from); highlighted.add(edge.to); }
  }
  const focusing = highlighted.size > 0;
  const fit = graphFit(graph.width, graph.height, viewport.width, viewport.height);
  const scale = fit * zoom;
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const clearSelection = () => { setSelectedId(null); setSelectedEdgeKey(null); };
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const resize = () => { const { width, height } = element.getBoundingClientRect(); setViewport({ width, height }); };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setExpanded([]); clearSelection(); setHoveredId(null); setHoveredEdgeKey(null); resetView();
  }, [kind, left, right, filter]);
  // Fit new discoveries and responsive layouts, without resetting the view when
  // selection or the details drawer changes.
  useEffect(resetView, [graph, viewport.width, viewport.height]);
  const selectNode = (id: string) => { setSelectedId(id); setSelectedEdgeKey(null); };
  const selectEdge = (edge: GraphEdge) => { setSelectedEdgeKey(graphEdgeKey(edge)); setSelectedId(null); };
  const selectedNode = selectedId ? lookup.get(selectedId) : undefined;
  const activeArtist = selectedNode?.entityType === 'artist' ? getArtist(selectedNode.id) : undefined;
  const activeSong = selectedNode?.entityType === 'song' ? getSong(selectedNode.id) : undefined;
  const canExpand = !!selectedId && graph.expandable.includes(selectedId);
  const edgeDescription = (edge: GraphEdge) => `${edge.category === 'similarity' ? 'Musical similarity · calculated' : 'Factual connection'}: ${lookup.get(edge.from)?.label} and ${lookup.get(edge.to)?.label}. ${edge.label}. ${edge.detail || ''}`;
  const hoveredRoute = routed.find(r => graphEdgeKey(r.edge) === hoveredEdgeKey);
  const tooltipPosition = hoveredRoute ? {
    left: Math.max(12, Math.min(viewport.width - 252, viewport.width / 2 + pan.x + (hoveredRoute.midpoint.x - graph.width / 2) * scale - 120)),
    top: Math.max(12, Math.min(viewport.height - 140, (viewport.height - 42) / 2 + pan.y + (hoveredRoute.midpoint.y - graph.height / 2) * scale - 86))
  } : undefined;

  return <div className="relationship-graph">
    <div ref={canvas} className="graph-canvas" tabIndex={0} aria-label="Connection web. Drag the background to pan, or use arrow keys. Select a node to explore, or a connection for relationship details." onKeyDown={e => {
      if (e.key === 'Escape') { clearSelection(); setHoveredId(null); setHoveredEdgeKey(null); }
      if (e.target !== e.currentTarget) return;
      const move: Record<string, [number, number]> = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] };
      if (move[e.key]) { e.preventDefault(); setPan(p => ({ x: p.x + move[e.key][0], y: p.y + move[e.key][1] })); }
    }} onPointerDown={e => {
      if (e.button !== 0 || (e.target as Element).closest('button, [data-graph-edge]')) return;
      drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e => {
      if (drag.current) setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
    }} onPointerUp={e => {
      if (drag.current && Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) < 4) clearSelection();
      drag.current = null;
    }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <div className="graph-grid"/>
      <div className="graph-stage" style={{ width: graph.width, height: graph.height, left: viewport.width / 2 + pan.x, top: (viewport.height - 42) / 2 + pan.y, transform: `translate(-50%, -50%) scale(${scale})`, '--graph-node-width': `${graph.nodeWidth}px` } as CSSProperties}>
        <svg className="graph-edges" viewBox={`0 0 ${graph.width} ${graph.height}`} aria-label="Relationships">
          {routed.map(({ edge, d }) => {
            const key = graphEdgeKey(edge);
            const active = activeEdge ? key === activeEdgeKey : !!focusId && (edge.from === focusId || edge.to === focusId);
            return <g key={key} className={`graph-link ${edge.category === 'similarity' ? 'is-similarity' : 'is-factual'} ${edge.onPath ? 'is-path' : ''} ${active ? 'is-active' : ''} ${focusing && !active ? 'is-dimmed' : ''}`}>
              <path className="graph-link-line" d={d} fill="none" strokeDasharray={edge.category === 'similarity' ? '5 6' : undefined} vectorEffect="non-scaling-stroke"/>
              <path className="graph-link-hit" data-graph-edge={key} d={d} fill="none" stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" role="button" tabIndex={0} aria-label={edgeDescription(edge)} aria-pressed={selectedEdgeKey === key}
                onPointerEnter={() => { setHoveredEdgeKey(key); setHoveredId(null); }} onPointerLeave={() => setHoveredEdgeKey(null)}
                onFocus={() => { setHoveredEdgeKey(key); setHoveredId(null); }} onBlur={() => setHoveredEdgeKey(null)}
                onClick={() => selectEdge(edge)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectEdge(edge); } }}>
                <title>{edgeDescription(edge)}</title>
              </path>
            </g>;
          })}
        </svg>
        {graph.nodes.map(node => {
          const primary = node.role === 'Comparison anchor';
          const contributor = node.entityType === 'artist' && getArtist(node.id)?.kind === 'contributor';
          const subtitle = node.entityType === 'song' ? getArtist(getSong(node.id)!.artistId)?.name : contributor ? 'Contributor' : 'Artist';
          return <button key={node.id} className={`graph-node ${node.entityType === 'song' ? 'is-song' : ''} ${contributor ? 'is-contributor' : ''} ${primary ? 'is-primary' : ''} ${selectedId === node.id ? 'is-selected' : ''} ${focusing && !highlighted.has(node.id) ? 'is-dimmed' : ''}`}
            style={{ left: node.x, top: node.y }} onClick={() => selectNode(node.id)}
            onPointerEnter={() => { setHoveredId(node.id); setHoveredEdgeKey(null); }} onPointerLeave={() => setHoveredId(null)}
            onFocus={() => { setHoveredId(node.id); setHoveredEdgeKey(null); }} onBlur={() => setHoveredId(null)}
            aria-pressed={selectedId === node.id} aria-label={`${node.label}, ${primary ? `comparison ${node.id === left ? 'one' : 'two'}` : subtitle}. Select node`} title={`${node.label} · ${subtitle}`}>
            <span className="graph-node-visual">{node.entityType === 'song' ? <AlbumCover song={getSong(node.id)!}/> : <ArtistAvatar artist={getArtist(node.id)!}/>}{primary && <span className="graph-anchor-index">{node.id === left ? '1' : '2'}</span>}</span>
            <strong>{node.label}</strong><small>{subtitle}</small>
          </button>;
        })}
      </div>
      {hoveredRoute && <div className="graph-edge-tooltip" role="tooltip" style={tooltipPosition}><small>{hoveredRoute.edge.category === 'similarity' ? 'Musical similarity · calculated' : 'Factual connection'}</small><strong>{hoveredRoute.edge.label}</strong><span>{lookup.get(hoveredRoute.edge.from)?.label} ↔ {lookup.get(hoveredRoute.edge.to)?.label}</span><em>Select connection for details</em></div>}
      <div className="graph-controls"><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 2.4} onClick={() => setZoom(z => Math.min(2.4, z + .2))}><Plus size={17}/></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" aria-label="Zoom out" disabled={zoom <= .6} onClick={() => setZoom(z => Math.max(.6, z - .2))}><Minus size={17}/></button><button className="icon-button" aria-label="Reset graph view" title="Fit and center graph" onClick={resetView}><Expand size={16}/></button></div>
    </div>
    {selectedNode && <div className="graph-selection"><div><strong>{selectedNode.label}</strong><p>{activeArtist?.description || `${activeSong?.album} · ${getArtist(activeSong?.artistId || '')?.name}`}</p>{canExpand && <small>More connections available</small>}</div><button className="text-cta" onClick={() => onSelect({ type: selectedNode.entityType, id: selectedNode.id })}>View details <ArrowLeft className="reverse-arrow" size={14}/></button><button className="secondary-button" disabled={!canExpand} onClick={() => setExpanded(p => [...p, selectedNode.id])}><Plus size={14}/> Show more</button><button className="icon-button" aria-label="Clear node selection" onClick={clearSelection}><X size={16}/></button></div>}
    {selectedEdge && <div className="graph-selection graph-edge-selection"><div><small className="graph-relationship-category">{selectedEdge.category === 'similarity' ? 'Musical similarity · calculated from metadata' : 'Factual connection · documented relationship'}</small><strong>{lookup.get(selectedEdge.from)?.label} <span aria-hidden="true">↔</span> {lookup.get(selectedEdge.to)?.label}</strong>
      {(selectedEdge.relationships || [selectedEdge]).map((record, i) => <div className="graph-relationship-detail" key={record.relationshipId || i}><b>{record.label}</b><p>{record.detail}</p>{!!record.sourceUrls?.length && <div className="graph-sources">{record.sourceUrls.map((url, index) => <a href={url} key={url} target="_blank" rel="noreferrer">Source {index + 1}</a>)}</div>}</div>)}
    </div><button className="icon-button" aria-label="Clear connection selection" onClick={clearSelection}><X size={16}/></button></div>}
    <div className="graph-foot"><span className="graph-hint">Select a node or connection to explore</span><button className="text-cta" onClick={() => { setExpanded([]); clearSelection(); resetView(); }}><RotateCcw size={13}/> Initial comparison</button></div>
    {filter !== 'All genres' && <p className="filter-caption">Showing {filter} connections. Your two comparison anchors{kind === 'artist' ? ' and credited contributor identities' : ''} stay visible.</p>}
    {graph.edges.length === 0 && <p className="filter-caption">{filter === 'All genres' ? 'No connections in this catalog.' : 'No connections match this genre. Try All genres.'}</p>}
  </div>;
}
