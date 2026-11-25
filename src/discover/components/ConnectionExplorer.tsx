"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { neighborhood, reasons as loadReasons } from "../api";
import { fitView, growWeb, layoutWeb, MAX_NODES, startWeb, zoomView, type Point, type View, type Web } from "../lib/layout";
import { connectionsHref } from "../lib/links";
import { CATEGORY_LABELS, entityHref, type Category, type GraphData, type GraphEdge, type Reason } from "../lib/types";
import CategoryFilter from "./CategoryFilter";
import EntitySearch from "./EntitySearch";
import { Avatar, plural, Reasons } from "./parts";

const OPEN_LIMIT = 12;

type Why = { key: string; reasons: Reason[]; total: number } | { key: string; failed: true };

type Props = { start: GraphData; categories: Category[] };

/** The connection web of one artist. The parent keys it by artist and filters, so a new start is a fresh web. */
export default function ConnectionExplorer({ start, categories }: Props) {
  const router = useRouter();
  const [web, setWeb] = useState<Web>(() => startWeb(start));
  const [points, setPoints] = useState<Map<string, Point>>(() => layoutWeb(startWeb(start)));
  const [view, setView] = useState<View>(() => fitView(points.values()));
  const [selected, setSelected] = useState(start.center);
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [why, setWhy] = useState<Why | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const byId = useMemo(() => new Map(web.nodes.map((n) => [n.id, n])), [web]);
  const edgesOf = useMemo(() => {
    const out = new Map<string, GraphEdge[]>();
    for (const e of web.edges) for (const id of [e.a, e.b]) out.set(id, [...(out.get(id) ?? []), e]);
    return out;
  }, [web]);
  const maxStrength = Math.max(1, ...web.edges.map((e) => e.strength));
  const node = byId.get(selected)!;
  const linked = new Set((edgesOf.get(selected) ?? []).flatMap((e) => [e.a, e.b]));
  // The reasons shown are those with the starting artist, or with the closest artist in view.
  const partner = selected === web.center
    ? null
    : linked.has(web.center)
      ? web.center
      : [...(edgesOf.get(selected) ?? [])].sort((p, q) => q.strength - p.strength).map((e) => (e.a === selected ? e.b : e.a))[0] ?? null;
  const whyKey = partner ? `${selected}|${partner}` : "";

  useEffect(() => {
    if (!partner) return;
    const controller = new AbortController();
    loadReasons(partner, selected, categories, controller.signal)
      .then((found) => setWhy({ key: whyKey, ...found }))
      .catch(() => { if (!controller.signal.aborted) setWhy({ key: whyKey, failed: true }); });
    return () => controller.abort();
  }, [selected, partner, whyKey, categories]);

  // React attaches wheel listeners as passive, so zooming without scrolling the page needs its own.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const at = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
      setView((v) => zoomView(v, event.deltaY > 0 ? 1.12 : 1 / 1.12, { x: v.x + at.x * v.width, y: v.y + at.y * v.height }));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const open = async (id: string) => {
    setOpening(id);
    setProblem("");
    try {
      const data = await neighborhood(id, categories, OPEN_LIMIT);
      const next = growWeb(web, data);
      const placed = layoutWeb(next, points);
      setWeb(next);
      setPoints(placed);
      setView(fitView(placed.values()));
    } catch {
      setProblem("That artist’s connections didn’t load. Try again.");
    } finally {
      setOpening(null);
    }
  };
  const zoom = (factor: number) => setView((v) => zoomView(v, factor, { x: v.x + v.width / 2, y: v.y + v.height / 2 }));
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const from = drag.current;
    if (!from || from.id !== event.pointerId) return;
    const box = event.currentTarget.getBoundingClientRect();
    const scale = Math.max(view.width / box.width, view.height / box.height);
    const [dx, dy] = [(event.clientX - from.x) * scale, (event.clientY - from.y) * scale];
    drag.current = { ...from, x: event.clientX, y: event.clientY };
    setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
  };
  const list = [...(edgesOf.get(selected) ?? [])].sort((p, q) => q.strength - p.strength);
  const used = [...new Set(web.edges.map((e) => e.category))];
  const full = web.nodes.length >= MAX_NODES;

  return (
    <div className="dx-explorer">
      <div className="dx-panel dx-explorer-bar">
        <EntitySearch label="Start from" placeholder="Another artist" kinds={["artist"]} onPick={(p) => router.push(connectionsHref(p.id, categories))} />
        <CategoryFilter value={categories} onChange={(next) => router.push(connectionsHref(web.center, next), { scroll: false })} />
      </div>
      <div className="dx-web">
        <svg
          ref={svg}
          viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
          role="group"
          aria-label={`Connections of ${byId.get(web.center)!.name}. The list beside it has the same content.`}
          onPointerDown={(e) => {
            if ((e.target as Element).closest(".dx-node")) return;
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
        >
          {web.edges.map((e) => {
            const [p, q] = [points.get(e.a)!, points.get(e.b)!];
            return (
              <line
                key={`${e.a}|${e.b}`}
                className="dx-edge"
                data-category={e.category}
                data-on={e.a === selected || e.b === selected || undefined}
                x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                strokeWidth={1 + 5 * Math.sqrt(e.strength / maxStrength)}
              />
            );
          })}
          {web.nodes.map((n) => {
            const p = points.get(n.id)!;
            const radius = n.id === web.center ? 30 : 16 + Math.min(10, Math.sqrt(n.degree) / 2);
            return (
              <g
                key={n.id}
                className="dx-node"
                data-center={n.id === web.center || undefined}
                data-opened={web.opened.includes(n.id) || undefined}
                data-selected={n.id === selected || undefined}
                data-near={linked.has(n.id) || undefined}
                transform={`translate(${p.x} ${p.y})`}
                role="button"
                tabIndex={0}
                aria-pressed={n.id === selected}
                aria-label={n.name}
                onClick={() => setSelected(n.id)}
                onDoubleClick={() => void open(n.id)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  setSelected(n.id);
                }}
              >
                <circle r={radius} />
                <text y={radius + 15}>{n.name}</text>
              </g>
            );
          })}
        </svg>
        <div className="dx-web-tools">
          <button type="button" onClick={() => zoom(1 / 1.3)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => zoom(1.3)} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => setView(fitView(points.values()))}>Fit</button>
        </div>
        <ul className="dx-legend">{used.map((c) => <li key={c} data-category={c}>{CATEGORY_LABELS[c]}</li>)}</ul>
      </div>
      <aside className="dx-panel dx-side" aria-live="polite">
        <p className="dx-picked">
          <Avatar id={node.id} name={node.name} size={52} />
          <span><strong>{node.name}</strong><small>{node.note || plural(node.degree, "connection")}</small></span>
        </p>
        <p className="dx-actions">
          <button type="button" className="dx-button" disabled={opening !== null || web.opened.includes(selected) || full} onClick={() => void open(selected)}>
            {opening === selected ? "Opening…" : web.opened.includes(selected) ? "Connections open" : "Open their connections"}
          </button>
          <Link className="dx-button dx-quiet" href={entityHref({ kind: "artist", id: node.id })}>Artist page</Link>
        </p>
        {full && <p className="dx-hint">This web is full ({MAX_NODES} artists). Start from another artist to keep going.</p>}
        {problem && <p className="dx-hint" role="alert">{problem}</p>}
        {partner && (
          <>
            <h3>With {byId.get(partner)!.name}</h3>
            {why?.key !== whyKey ? <p className="dx-hint">Loading…</p> : "failed" in why ? <p className="dx-hint">The credits didn’t load.</p> : <Reasons reasons={why.reasons} total={why.total} />}
          </>
        )}
        <h3>{selected === web.center ? `Closest of ${plural(node.degree, "connection")}` : "Also connected here"}</h3>
        <ul className="dx-side-list">
          {list.map((e) => {
            const other = byId.get(e.a === selected ? e.b : e.a)!;
            return (
              <li key={other.id}>
                <button type="button" onClick={() => setSelected(other.id)}>
                  <span>{other.name}</span>
                  <small>{plural(e.count, "credit")}, mostly {CATEGORY_LABELS[e.category].toLowerCase()}</small>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
