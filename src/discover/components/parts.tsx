// Small pieces Discover's pages share. Usable from server and client components.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { photoSources } from "../lib/images";
import { entityHref, type ArtistRef, type EntityRef, type Reason } from "../lib/types";

const hueOf = (id: string) =>
  [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);

export function initialsOf(name: string): string {
  const words = name
    .replace(/^The\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => [...word][0])
    .join("")
    .toUpperCase();
}

type AvatarProps = {
  id: string;
  name: string;
  photo?: string | null;
  size?: number;
  /** Photos at the top of a page load right away; the rest wait until they are near. */
  eager?: boolean;
};

/** An artist's photo over their initials, so a missing or slow photo never leaves a hole. */
export function Avatar({ id, name, photo, size = 44, eager = false }: AvatarProps) {
  return (
    <span
      className="dx-avatar"
      style={{ "--hue": hueOf(id), "--size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {initialsOf(name)}
      {photo && (
        // Hot-linked from Commons at a size it keeps ready, so it needs no image service of ours.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...photoSources(photo, size)}
          alt=""
          width={size}
          height={size}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
        />
      )}
    </span>
  );
}

/** An album cover from the Cover Art Archive, or a plain tile. */
export function Cover({ url, size = 48 }: { url?: string | null; size?: number }) {
  return (
    <span
      className="dx-cover"
      style={{ "--size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" />
      )}
    </span>
  );
}

export function ArtistLink({ artist, children }: { artist: ArtistRef; children?: ReactNode }) {
  return (
    <Link className="dx-row" href={entityHref({ kind: "artist", id: artist.id })} prefetch={false}>
      <Avatar id={artist.id} name={artist.name} photo={artist.photo} />
      <span className="dx-row-text">
        <strong>{artist.name}</strong>
        <small>{children ?? artist.note}</small>
      </span>
    </Link>
  );
}

/** An artist as a portrait, for the places that introduce people. */
export function ArtistCard({ artist }: { artist: ArtistRef }) {
  return (
    <Link
      className="dx-portrait"
      href={entityHref({ kind: "artist", id: artist.id })}
      prefetch={false}
    >
      <Avatar id={artist.id} name={artist.name} photo={artist.photo} size={112} />
      <strong>{artist.name}</strong>
      <small>{artist.note}</small>
    </Link>
  );
}

export function SongLink({ song, note }: { song: EntityRef; note?: ReactNode }) {
  return (
    <Link className="dx-row" href={entityHref(song)} prefetch={false}>
      <Cover url={song.image} />
      <span className="dx-row-text">
        <strong>{song.name}</strong>
        <small>{note ?? song.note}</small>
      </span>
    </Link>
  );
}

type AppLinkProps = { href: string; className?: string; children: ReactNode };

/** A link into the rest of Song Nexus: a plain anchor, as its pages read the address on load. */
export function AppLink({ href, className, children }: AppLinkProps) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

type SectionProps = { id?: string; title: string; note?: ReactNode; children: ReactNode };

export function Section({ id, title, note, children }: SectionProps) {
  return (
    <section className="dx-panel" id={id} aria-label={title}>
      <header className="dx-section-head">
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </header>
      {children}
    </section>
  );
}

/** A disclosure for the rest of a list. */
export function More({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="dx-more">
      <summary>{label}</summary>
      {children}
    </details>
  );
}

export function Reasons({ reasons, total }: { reasons: Reason[]; total: number }) {
  const more = total - reasons.length;
  return (
    <ul className="dx-reasons">
      {reasons.map((reason, i) => (
        <li key={i} data-category={reason.category}>
          {reason.subject ? (
            <Link href={entityHref(reason.subject)} prefetch={false}>
              {reason.text}
            </Link>
          ) : (
            reason.text
          )}
          {reason.year !== null && <span className="dx-year">{reason.year}</span>}
        </li>
      ))}
      {more > 0 && <li className="dx-rest">and {plural(more, "more credit", "more credits")}</li>}
    </ul>
  );
}

export function Chips({ items, label }: { items: EntityRef[]; label: string }) {
  return (
    <ul className="dx-chips" aria-label={label}>
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`}>
          <Link href={entityHref(item)} prefetch={false}>
            {item.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The page's shape while its content is on the way. */
export function Skeleton({ panels = 2 }: { panels?: number }) {
  return (
    <div className="dx-skeleton" role="status" aria-label="Loading">
      {Array.from({ length: panels }, (_, i) => (
        <div key={i} className="dx-panel" aria-hidden="true">
          <span className="dx-bone dx-bone-title" />
          <span className="dx-bone" />
          <span className="dx-bone dx-bone-short" />
        </div>
      ))}
    </div>
  );
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
}
