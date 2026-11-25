"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { neighborhood, reasons as loadReasons } from "../api";
import { MAX_NODES, type Web } from "../lib/layout";
import { connectionsHref, sixDegreesHref } from "../lib/links";
import {
  CATEGORY_LABELS,
  entityHref,
  OPEN_LIMIT,
  type Category,
  type GraphData,
  type GraphEdge,
  type Reason,
} from "../lib/types";
import ShareButton from "./ShareButton";
import { useWeb } from "./useWeb";
import WebCanvas from "./WebCanvas";
import { Avatar, plural, Reasons } from "./parts";

type Why = { key: string; found: { reasons: Reason[]; total: number } | null };
type Props = { start: GraphData; opened: GraphData[]; categories: Category[] };

const otherEnd = (edge: GraphEdge, id: string) => (edge.a === id ? edge.b : edge.a);

/** Keeps the address in step with the web, so a copied link shows the same one. */
function remember(web: Web, categories: readonly Category[]) {
  window.history.replaceState(
    null,
    "",
    connectionsHref(web.center, categories, web.opened.slice(1)),
  );
}

/** One artist's collaborators. The parent keys it by artist and filters, so a new start is fresh. */
export default function ConnectionExplorer({ start, opened, categories }: Props) {
  const { web, points, view, canUndo, grow, undo, fit, setView } = useWeb(start, opened);
  const [choice, setChoice] = useState(start.center);
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [why, setWhy] = useState<Why | null>(null);

  const byId = useMemo(() => new Map(web.nodes.map((n) => [n.id, n])), [web]);
  // Undoing can take away the chosen artist.
  const selected = byId.has(choice) ? choice : web.center;
  const node = byId.get(selected)!;
  const links = useMemo(
    () =>
      web.edges
        .filter((e) => e.a === selected || e.b === selected)
        .sort((p, q) => q.strength - p.strength),
    [web, selected],
  );
  // The credits shown are with the starting artist, else with the closest artist in view.
  const closest = links.length ? otherEnd(links[0], selected) : null;
  const meetsCenter = links.some((e) => otherEnd(e, selected) === web.center);
  const partner = selected === web.center ? null : meetsCenter ? web.center : closest;
  const whyKey = partner ? `${partner}|${selected}` : "";

  useEffect(() => {
    if (!partner) return;
    const controller = new AbortController();
    loadReasons(partner, selected, categories, controller.signal)
      .then((found) => setWhy({ key: whyKey, found }))
      .catch(() => {
        if (!controller.signal.aborted) setWhy({ key: whyKey, found: null });
      });
    return () => controller.abort();
  }, [partner, selected, whyKey, categories]);

  const full = web.nodes.length >= MAX_NODES;
  const isOpen = web.opened.includes(selected);

  const open = async (id: string) => {
    setChoice(id);
    if (opening || full || web.opened.includes(id)) return;
    setOpening(id);
    setProblem("");
    try {
      remember(grow(await neighborhood(id, categories, OPEN_LIMIT)), categories);
    } catch {
      setProblem(
        `The connections of ${byId.get(id)?.name ?? "that artist"} didn’t load. Try again.`,
      );
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="dx-explorer">
      <WebCanvas
        web={web}
        points={points}
        view={view}
        selected={selected}
        opening={opening}
        canUndo={canUndo}
        onSelect={setChoice}
        onOpen={(id) => void open(id)}
        onUndo={() => {
          const before = undo();
          if (before) remember(before, categories);
        }}
        onFit={fit}
        onView={setView}
      />
      <section className="dx-panel dx-side" aria-label="Selected artist">
        <div className="dx-picked">
          <Avatar id={node.id} name={node.name} photo={node.photo} size={64} eager />
          <span>
            <h2 aria-live="polite">{node.name}</h2>
            <small>{node.note || plural(node.degree, "connection")}</small>
          </span>
        </div>
        <div className="dx-actions">
          {!isOpen && (
            <button
              type="button"
              className="dx-button"
              disabled={opening !== null || full}
              onClick={() => void open(selected)}
            >
              {opening === selected ? "Opening…" : "Open their connections"}
            </button>
          )}
          <Link
            className="dx-button dx-quiet"
            href={entityHref({ kind: "artist", id: node.id })}
            prefetch={false}
          >
            Artist page
          </Link>
          {selected !== web.center && (
            <Link
              className="dx-button dx-quiet"
              href={sixDegreesHref({ from: byId.get(web.center)!, to: node })}
              prefetch={false}
            >
              Six Degrees
            </Link>
          )}
          <ShareButton label="Share" title={`${byId.get(web.center)!.name}’s collaborators`} />
        </div>
        {full && (
          <p className="dx-hint">
            This web is full ({MAX_NODES} artists). Undo a step, or start from someone else.
          </p>
        )}
        {problem && (
          <p className="dx-hint" role="alert">
            {problem}
          </p>
        )}
        {partner && (
          <>
            <h3>With {byId.get(partner)!.name}</h3>
            {why?.key !== whyKey ? (
              <div className="dx-bones" role="status" aria-label="Loading credits">
                <span className="dx-bone" />
                <span className="dx-bone" />
                <span className="dx-bone dx-bone-short" />
              </div>
            ) : why.found ? (
              <Reasons reasons={why.found.reasons} total={why.found.total} />
            ) : (
              <p className="dx-hint">The credits didn’t load.</p>
            )}
          </>
        )}
        <h3>
          {selected === web.center
            ? `Closest of ${plural(node.degree, "connection")}`
            : "Also connected here"}
        </h3>
        {links.length === 0 && (
          <p className="dx-hint">No one, through these kinds of connection.</p>
        )}
        <ul className="dx-side-list">
          {links.map((edge) => {
            const other = byId.get(otherEnd(edge, selected))!;
            return (
              <li key={other.id}>
                <button type="button" onClick={() => setChoice(other.id)}>
                  <Avatar id={other.id} name={other.name} photo={other.photo} size={36} />
                  <span>
                    <strong>{other.name}</strong>
                    <small data-category={edge.category}>
                      {plural(edge.count, "credit")}, mostly{" "}
                      {CATEGORY_LABELS[edge.category].toLowerCase()}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
