"use client";

import { useMemo } from "react";
import { recentIn, RECENT_KEY } from "../lib/stored";
import { ArtistCard } from "./parts";
import { useStored } from "./useStored";

/** The artists opened lately in this browser; nothing until there are some. */
export default function RecentShelf({ title }: { title: string }) {
  const stored = useStored(RECENT_KEY);
  const recent = useMemo(() => recentIn(stored), [stored]);
  if (!recent.length) return null;
  return (
    <section className="dx-panel" aria-label={title}>
      <header className="dx-section-head">
        <h2>{title}</h2>
        <p>Kept in this browser only.</p>
      </header>
      <div className="dx-portraits">
        {recent.map((visit) => (
          <ArtistCard key={visit.id} artist={{ ...visit, listeners: null }} />
        ))}
      </div>
    </section>
  );
}
