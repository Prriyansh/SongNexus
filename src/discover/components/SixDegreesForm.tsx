"use client";

import { ArrowLeftRight, Shuffle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sixDegreesHref, type SixDegreesState } from "../lib/links";
import type { ArtistRef } from "../lib/types";
import CategoryFilter from "./CategoryFilter";
import EntitySearch from "./EntitySearch";
import { Avatar } from "./parts";

type Pair = { from: ArtistRef; to: ArtistRef };
type End = "from" | "to";

const ORDERS = [
  ["shortest", "Fewest steps"],
  ["strongest", "Closest connections"],
] as const;

type SlotProps = { label: string; artist: ArtistRef | null; onPick: (artist: ArtistRef) => void };

/** One end of the path: the artist, or a search for one. */
function Slot({ label, artist, onPick }: SlotProps) {
  const [changing, setChanging] = useState(false);
  if (artist && !changing) {
    return (
      <div className="dx-slot">
        <span className="dx-slot-label">{label}</span>
        <div className="dx-picked">
          <Avatar id={artist.id} name={artist.name} photo={artist.photo} size={64} eager />
          <span>
            <strong>{artist.name}</strong>
            <small>{artist.note}</small>
          </span>
          <button
            type="button"
            className="dx-text-button"
            onClick={() => setChanging(true)}
            aria-label={`Change ${artist.name}`}
          >
            Change
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="dx-slot">
      <EntitySearch
        label={label}
        placeholder="Search for an artist"
        kinds={["artist"]}
        onPick={(picked) => {
          setChanging(false);
          const { id, name, note, image } = picked;
          onPick({ id, name, note, listeners: null, photo: image ?? null });
        }}
      />
      {artist && (
        <button type="button" className="dx-text-button" onClick={() => setChanging(false)}>
          Keep {artist.name}
        </button>
      )}
    </div>
  );
}

/** What to look for. Everything is in the address, so any result can be shared. */
export default function SixDegreesForm({
  state,
  surprises,
}: {
  state: SixDegreesState;
  surprises: Pair[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const go = (change: Partial<SixDegreesState>) =>
    startTransition(() => router.push(sixDegreesHref({ ...state, ...change }), { scroll: false }));
  const pick = (end: End) => (artist: ArtistRef) => go({ [end]: artist, avoid: [] });
  const surprise = () => {
    const others = surprises.filter(
      (pair) => pair.from.id !== state.from?.id || pair.to.id !== state.to?.id,
    );
    const pair = others[Math.floor(Math.random() * others.length)];
    if (pair) go({ from: pair.from, to: pair.to, avoid: [] });
  };

  return (
    <div className="dx-panel dx-six-form" aria-busy={busy}>
      <div className="dx-slots">
        <Slot label="From" artist={state.from} onPick={pick("from")} />
        <button
          type="button"
          className="dx-round"
          disabled={!state.from && !state.to}
          onClick={() => go({ from: state.to, to: state.from })}
          aria-label="Swap the two artists"
        >
          <ArrowLeftRight size={18} aria-hidden="true" />
        </button>
        <Slot label="To" artist={state.to} onPick={pick("to")} />
      </div>
      <div className="dx-six-bar">
        <fieldset className="dx-segments">
          <legend className="dx-visually-hidden">Which path to prefer</legend>
          {ORDERS.map(([order, label]) => (
            <label key={order}>
              <input
                type="radio"
                name="order"
                checked={state.order === order}
                onChange={() => go({ order })}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <button type="button" className="dx-button dx-quiet" onClick={surprise}>
          <Shuffle size={16} aria-hidden="true" />
          Surprise me
        </button>
      </div>
      <CategoryFilter value={state.categories} onChange={(categories) => go({ categories })} />
      {state.avoid.length > 0 && (
        <div className="dx-avoid">
          <span>Going around</span>
          {state.avoid.map((artist) => (
            <button
              key={artist.id}
              type="button"
              onClick={() => go({ avoid: state.avoid.filter((a) => a.id !== artist.id) })}
              aria-label={`Allow ${artist.name} again`}
            >
              {artist.name}
              <X size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <div className="dx-busy" data-on={busy || undefined} aria-hidden="true" />
    </div>
  );
}
