"use client";

import { Maximize, Minus, Plus, Undo2 } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { photoAt } from "../lib/images";
import {
  ARROWS,
  edgeKey,
  nextInDirection,
  radiusOf,
  visibleLabels,
  zoomView,
  type Label,
  type Point,
  type View,
  type Web,
} from "../lib/layout";
import { CATEGORY_LABELS } from "../lib/types";
import { initialsOf } from "./parts";

const LABEL_PX = 12;
const ZOOM_STEP = 1.3;
const WHEEL_STEP = 1.12;

type Props = {
  web: Web;
  points: ReadonlyMap<string, Point>;
  view: View;
  selected: string;
  opening: string | null;
  canUndo: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onUndo: () => void;
  onFit: () => void;
  onView: (change: (view: View) => View) => void;
};

const middle = (view: View): Point => ({ x: view.x + view.width / 2, y: view.y + view.height / 2 });

/** The drawing of a connection web: drag to move, scroll or pinch to zoom, arrow keys to walk. */
export default function WebCanvas(props: Props) {
  const { web, points, view, selected, opening, canUndo, onSelect, onOpen, onUndo, onFit, onView } =
    props;
  const clip = useId();
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const [box, setBox] = useState({ width: 800, height: 620 });
  const [hovered, setHovered] = useState<string | null>(null);
  const focus = hovered ?? selected;

  useEffect(() => {
    const element = svg.current!;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setBox({ width, height });
    });
    observer.observe(element);
    // React listens to the wheel passively, so zooming without scrolling the page needs its own.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      const at = { x: event.clientX, y: event.clientY };
      onView((v) => zoomView(v, factor, toWorld(element, v, at)));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", onWheel);
    };
  }, [onView]);

  // World units per screen pixel: names keep one size on screen however far the view is.
  const unit = Math.max(view.width / box.width, view.height / box.height);
  const fontSize = LABEL_PX * unit;

  const near = useMemo(() => {
    const ids = new Set([focus]);
    for (const e of web.edges) if (e.a === focus || e.b === focus) ids.add(e.a).add(e.b);
    return ids;
  }, [web, focus]);

  const labels = useMemo(() => {
    const all: Label[] = web.nodes.map((node, i) => ({
      id: node.id,
      text: node.name,
      ...points.get(node.id)!,
      radius: radiusOf(node, web.center),
      priority: (near.has(node.id) ? 1000 : 0) - i,
      always: node.id === focus || node.id === web.center,
    }));
    return visibleLabels(all, fontSize);
  }, [web, points, focus, near, fontSize]);

  const strongest = Math.max(1, ...web.edges.map((e) => e.strength));
  const used = [...new Set(web.edges.map((e) => e.category))];

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (!before) return;
    const element = event.currentTarget;
    const now = { x: event.clientX, y: event.clientY };
    const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1];
    pointers.current.set(event.pointerId, now);
    if (other) {
      const spread = (p: Point) => Math.hypot(p.x - other.x, p.y - other.y) || 1;
      const center = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
      onView((v) => zoomView(v, spread(before) / spread(now), toWorld(element, v, center)));
    } else {
      onView((v) => {
        const scale = Math.max(v.width / box.width, v.height / box.height);
        return { ...v, x: v.x - (now.x - before.x) * scale, y: v.y - (now.y - before.y) * scale };
      });
    }
  };
  const release = (event: PointerEvent) => pointers.current.delete(event.pointerId);

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const arrow = ARROWS[event.key];
    const next = arrow && nextInDirection(points, selected, arrow);
    if (next) {
      onSelect(next);
      svg.current?.querySelector<SVGGElement>(`[data-id="${next}"]`)?.focus();
    } else if (event.key === "Enter") onOpen(selected);
    else if (event.key === "+" || event.key === "=") zoom(1 / ZOOM_STEP);
    else if (event.key === "-") zoom(ZOOM_STEP);
    else if (event.key === "0") onFit();
    else if (!arrow) return;
    event.preventDefault();
  };
  const zoom = (factor: number) => onView((v) => zoomView(v, factor, middle(v)));

  return (
    <div className="dx-web">
      <svg
        ref={svg}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        role="group"
        aria-label="Connection web. Arrow keys move between artists, Enter opens one, plus and minus zoom. The list after it has the same content."
        data-focused={hovered !== null || undefined}
        onPointerDown={(event) => {
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if ((event.target as Element).closest(".dx-node")) return;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
        onKeyDown={onKeyDown}
      >
        <defs>
          <clipPath id={clip} clipPathUnits="objectBoundingBox">
            <circle cx=".5" cy=".5" r=".5" />
          </clipPath>
        </defs>
        {web.edges.map((e) => {
          const [p, q] = [points.get(e.a)!, points.get(e.b)!];
          return (
            <line
              key={edgeKey(e)}
              className="dx-edge"
              data-category={e.category}
              data-on={e.a === focus || e.b === focus || undefined}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              strokeWidth={1 + 5 * Math.sqrt(e.strength / strongest)}
            />
          );
        })}
        {web.nodes.map((node) => {
          const p = points.get(node.id)!;
          const r = radiusOf(node, web.center);
          return (
            <g
              key={node.id}
              className="dx-node"
              data-id={node.id}
              data-center={node.id === web.center || undefined}
              data-opened={web.opened.includes(node.id) || undefined}
              data-selected={node.id === selected || undefined}
              data-near={near.has(node.id) || undefined}
              data-opening={node.id === opening || undefined}
              transform={`translate(${p.x} ${p.y})`}
              role="button"
              tabIndex={node.id === selected ? 0 : -1}
              aria-pressed={node.id === selected}
              aria-label={node.name}
              onClick={() => onSelect(node.id)}
              onDoubleClick={() => onOpen(node.id)}
              onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(node.id)}
              onPointerLeave={() => setHovered(null)}
            >
              <circle className="dx-node-face" r={r} />
              {node.photo ? (
                <image
                  href={photoAt(node.photo, r * 2)}
                  x={-r}
                  y={-r}
                  width={r * 2}
                  height={r * 2}
                  clipPath={`url(#${clip})`}
                  preserveAspectRatio="xMidYMin slice"
                />
              ) : (
                <text className="dx-node-initials" dy=".35em" fontSize={r * 0.72}>
                  {initialsOf(node.name)}
                </text>
              )}
              <circle className="dx-node-ring" r={r} />
            </g>
          );
        })}
        {web.nodes.map((node) => {
          if (!labels.has(node.id)) return null;
          const p = points.get(node.id)!;
          return (
            <text
              key={node.id}
              className="dx-node-name"
              data-near={near.has(node.id) || undefined}
              x={p.x}
              y={p.y + radiusOf(node, web.center) + fontSize * 1.15}
              fontSize={fontSize}
              strokeWidth={fontSize / 3}
            >
              {node.name}
            </text>
          );
        })}
      </svg>
      <div className="dx-web-tools" role="group" aria-label="View">
        <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo">
          <Undo2 size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => zoom(1 / ZOOM_STEP)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Plus size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => zoom(ZOOM_STEP)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Minus size={17} aria-hidden="true" />
        </button>
        <button type="button" onClick={onFit} aria-label="Show everyone" title="Show everyone">
          <Maximize size={17} aria-hidden="true" />
        </button>
      </div>
      <ul className="dx-legend" aria-label="Line colors">
        {used.map((category) => (
          <li key={category} data-category={category}>
            {CATEGORY_LABELS[category]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where a point on screen is in the web. The drawing is centered in its box, at one scale. */
function toWorld(element: Element, view: View, at: Point): Point {
  const box = element.getBoundingClientRect();
  const scale = Math.max(view.width / box.width, view.height / box.height);
  return {
    x: view.x + view.width / 2 + (at.x - box.left - box.width / 2) * scale,
    y: view.y + view.height / 2 + (at.y - box.top - box.height / 2) * scale,
  };
}
