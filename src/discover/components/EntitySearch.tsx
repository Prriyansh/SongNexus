"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { search } from "../api";
import { entityHref, type EntityKind, type EntityRef } from "../lib/types";

const DEBOUNCE_MS = 200;
const KIND_LABELS: Record<EntityKind, string> = { artist: "Artist", song: "Song", label: "Label", genre: "Genre" };

type Props = {
  label: string;
  placeholder: string;
  kinds: readonly EntityKind[];
  /** What picking a result does; without it, the result's page opens. */
  onPick?: (picked: EntityRef) => void;
};

/** A search box with a list of results: type, then click or use the arrow keys and Enter. */
export default function EntitySearch({ label, placeholder, kinds, onPick }: Props) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState("");
  const [found, setFound] = useState<{ query: string; results: EntityRef[]; failed: boolean } | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const request = useRef<AbortController | null>(null);
  const kindList = kinds.join(",");
  const query = text.trim();

  useEffect(() => {
    if (!query) return;
    const timer = setTimeout(() => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      search(query, kindList, controller.signal)
        .then((results) => setFound({ query, results, failed: false }))
        .catch(() => {
          if (!controller.signal.aborted) setFound({ query, results: [], failed: true });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, kindList]);

  const results = query && found ? found.results : [];
  const ready = found?.query === query;
  const pick = (picked: EntityRef) => {
    setText("");
    setOpen(false);
    if (onPick) onPick(picked);
    else router.push(entityHref(picked));
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") setOpen(false);
    if (!results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((active + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
    } else if (event.key === "Enter" && ready) {
      event.preventDefault();
      pick(results[Math.min(active, results.length - 1)]);
    }
  };
  const showList = open && query !== "";

  return (
    <div className="dx-search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <label htmlFor={`${id}-input`}>{label}</label>
      <input
        id={`${id}-input`}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={text}
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-activedescendant={showList && results.length ? `${id}-${Math.min(active, results.length - 1)}` : undefined}
        onChange={(e) => { setText(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <div className="dx-results">
          <ul id={`${id}-list`} role="listbox" aria-label={label}>
            {results.map((result, i) => (
              <li
                key={`${result.kind}:${result.id}`}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(result)}
                onMouseEnter={() => setActive(i)}
              >
                <strong>{result.name}</strong>
                <small>{[kinds.length > 1 && KIND_LABELS[result.kind], result.note].filter(Boolean).join(" · ")}</small>
              </li>
            ))}
          </ul>
          {ready && !results.length && (
            <p role="status">{found.failed ? "Search isn’t working right now. Try again." : `Nothing called “${query}” in this catalog.`}</p>
          )}
        </div>
      )}
    </div>
  );
}
