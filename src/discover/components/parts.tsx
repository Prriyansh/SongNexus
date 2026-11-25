// Small pieces Discover's pages share. Usable from server and client components.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { entityHref, type ArtistRef, type EntityRef, type Reason } from "../lib/types";

const hueOf = (id: string) => [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);

/** Initials on a color of their own: the catalog has no artist photos. */
export function Avatar({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
  const initials = name.replace(/^The\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => [...word][0]).join("").toUpperCase();
  return (
    <span className="dx-avatar" style={{ "--hue": hueOf(id), "--size": `${size}px` } as CSSProperties} aria-hidden="true">
      {initials}
    </span>
  );
}

export function ArtistLink({ artist, children }: { artist: ArtistRef; children?: ReactNode }) {
  return (
    <Link className="dx-row" href={entityHref({ kind: "artist", id: artist.id })}>
      <Avatar id={artist.id} name={artist.name} />
      <span className="dx-row-text">
        <strong>{artist.name}</strong>
        <small>{children ?? artist.note}</small>
      </span>
    </Link>
  );
}

/** A link into the rest of Song Nexus. A plain anchor: its pages read the address when they load. */
export function AppLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return <a href={href} className={className}>{children}</a>;
}

export function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="dx-panel">
      <header className="dx-section-head">
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </header>
      {children}
    </section>
  );
}

export function Reasons({ reasons, total }: { reasons: Reason[]; total: number }) {
  const more = total - reasons.length;
  return (
    <ul className="dx-reasons">
      {reasons.map((reason, i) => (
        <li key={i} data-category={reason.category}>
          {reason.subject ? <Link href={entityHref(reason.subject)}>{reason.text}</Link> : reason.text}
          {reason.year !== null && <span className="dx-year">{reason.year}</span>}
        </li>
      ))}
      {more > 0 && <li className="dx-more">and {more} more {more === 1 ? "credit" : "credits"}</li>}
    </ul>
  );
}

export function Chips({ items }: { items: EntityRef[] }) {
  return (
    <ul className="dx-chips">
      {items.map((item) => <li key={`${item.kind}:${item.id}`}><Link href={entityHref(item)}>{item.name}</Link></li>)}
    </ul>
  );
}

export function Missing({ what }: { what: string }) {
  return (
    <div className="dx-panel dx-empty">
      <h1>We don’t have this {what}</h1>
      <p>Discover covers a fixed catalog of artists, songs and labels, so not everything on MusicBrainz is here.</p>
      <Link className="dx-button" href="/discover">Back to Discover</Link>
    </div>
  );
}

export function Loading() {
  return <div className="dx-panel dx-empty" role="status">Loading…</div>;
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
