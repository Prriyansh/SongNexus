"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { sixDegreesHref, type SixDegreesState } from "../lib/links";
import type { ArtistRef } from "../lib/types";
import CategoryFilter from "./CategoryFilter";
import EntitySearch from "./EntitySearch";
import { Avatar } from "./parts";

type Pair = { from: ArtistRef; to: ArtistRef };

export default function SixDegreesForm({ state, surprises }: { state: SixDegreesState; surprises: Pair[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const go = (change: Partial<SixDegreesState>) => startTransition(() => router.push(sixDegreesHref({ ...state, ...change }), { scroll: false }));
  const surprise = () => {
    const others = surprises.filter((p) => p.from.id !== state.from?.id || p.to.id !== state.to?.id);
    const pick = others[Math.floor(Math.random() * others.length)];
    if (pick) go({ ...pick, avoid: [] });
  };
  const slot = (key: "from" | "to", label: string) => {
    const artist = state[key];
    return (
      <div className="dx-slot">
        {artist && (
          <p className="dx-picked">
            <Avatar id={artist.id} name={artist.name} size={52} />
            <span><strong>{artist.name}</strong><small>{artist.note}</small></span>
          </p>
        )}
        <EntitySearch
          label={label}
          placeholder={artist ? "Change artist" : "Search for an artist"}
          kinds={["artist"]}
          onPick={(p) => go({ [key]: { id: p.id, name: p.name, note: p.note, listeners: null }, avoid: [] })}
        />
      </div>
    );
  };
  return (
    <div className="dx-panel dx-six-form" aria-busy={busy}>
      <div className="dx-slots">
        {slot("from", "From")}
        <button type="button" className="dx-button dx-quiet" disabled={!state.from && !state.to} onClick={() => go({ from: state.to, to: state.from })}>Swap</button>
        {slot("to", "To")}
      </div>
      <div className="dx-six-options">
        <fieldset className="dx-segments">
          <legend>Prefer</legend>
          {([["shortest", "Fewest steps"], ["strongest", "Closest connections"]] as const).map(([order, label]) => (
            <label key={order}>
              <input type="radio" name="order" checked={state.order === order} onChange={() => go({ order })} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <button type="button" className="dx-button dx-quiet" onClick={surprise}>Surprise me</button>
      </div>
      <CategoryFilter value={state.categories} onChange={(categories) => go({ categories })} />
      {state.avoid.length > 0 && (
        <p className="dx-avoid">
          Going around:{" "}
          {state.avoid.map((artist) => (
            <button key={artist.id} type="button" onClick={() => go({ avoid: state.avoid.filter((a) => a.id !== artist.id) })} aria-label={`Allow ${artist.name} again`}>
              {artist.name} ×
            </button>
          ))}
        </p>
      )}
    </div>
  );
}
