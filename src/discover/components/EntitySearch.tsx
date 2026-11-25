"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { search } from "../api";
import { matchRange } from "../lib/match";
import { entityHref, type EntityKind, type EntityRef } from "../lib/types";
import { Avatar, Cover } from "./parts";

const DEBOUNCE_MS = 160;
const KIND_LABELS: Record<EntityKind, string> = {
  artist: "Artist",
  song: "Song",
  label: "Label",
  genre: "Genre",
};

type Props = {
  label: string;
  placeholder: string;
  kinds: readonly EntityKind[];
  /** What picking a result does; without it, the result's page opens. */
  onPick?: (picked: EntityRef) => void;
  /** The page's main search: bigger, and "/" jumps to it. */
  main?: boolean;
};

type Found = { query: string; results: EntityRef[]; failed: boolean };

/** A name with the part that was searched for marked. */
function Marked({ text, query }: { text: string; query: string }): ReactNode {
  const range = matchRange(text, query);
  if (!range) return text;
  return (
    <>
      {text.slice(0, range[0])}
      <mark>{text.slice(...range)}</mark>
      {text.slice(range[1])}
    </>
  );
}

function ResultImage({ result }: { result: EntityRef }) {
  if (result.kind === "artist") {
    return <Avatar id={result.id} name={result.name} photo={result.image} size={40} />;
  }
  if (result.kind === "song") return <Cover url={result.image} size={40} />;
  return (
    <span className="dx-tag-icon" aria-hidden="true">
      {KIND_LABELS[result.kind][0]}
    </span>
  );
}

/** A search box with a list of results: type, then click, or use the arrow keys and Enter. */
export default function EntitySearch({ label, placeholder, kinds, onPick, main = false }: Props) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const kindList = kinds.join(",");
  const query = text.trim();

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      search(query, kindList, controller.signal)
        .then((results) => setFound({ query, results, failed: false }))
        .catch(() => {
          if (!controller.signal.aborted) setFound({ query, results: [], failed: true });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, kindList]);

  useEffect(() => {
    if (!main) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const typing = (event.target as Element | null)?.closest("input, textarea, select");
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || typing) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [main]);

  const results = query && found ? found.results : [];
  const ready = found?.query === query;
  const at = Math.min(active, Math.max(0, results.length - 1));
  const showList = open && query !== "";

  const pick = (picked: EntityRef) => {
    setText("");
    setOpen(false);
    input.current?.blur();
    if (onPick) onPick(picked);
    else router.push(entityHref(picked));
  };
  const move = (to: number) => {
    setOpen(true);
    setActive(to);
    list.current?.children[to]?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (showList) event.preventDefault();
      setOpen(false);
      return;
    }
    if (!results.length) return;
    const last = results.length - 1;
    if (event.key === "ArrowDown") move(at === last ? 0 : at + 1);
    else if (event.key === "ArrowUp") move(at === 0 ? last : at - 1);
    else if (event.key === "Enter" && ready && showList) pick(results[at]);
    else return;
    event.preventDefault();
  };

  return (
    <div
      className="dx-search"
      data-main={main || undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={`${id}-input`}>{label}</label>
      <div className="dx-field">
        <Search size={main ? 20 : 17} aria-hidden="true" />
        <input
          ref={input}
          id={`${id}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={placeholder}
          value={text}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={`${id}-list`}
          aria-activedescendant={showList && results.length ? `${id}-${at}` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query && !ready && <LoaderCircle className="dx-spin" size={17} aria-hidden="true" />}
        {text && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => {
              setText("");
              input.current?.focus();
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
        {main && !text && <kbd aria-hidden="true">/</kbd>}
      </div>
      <div className="dx-results" hidden={!showList || (!results.length && !ready)}>
        <ul id={`${id}-list`} ref={list} role="listbox" aria-label={label}>
          {results.map((result, i) => (
            <li
              key={`${result.kind}:${result.id}`}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === at}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(result)}
              onMouseMove={() => setActive(i)}
            >
              <ResultImage result={result} />
              <span>
                <strong>
                  <Marked text={result.name} query={query} />
                </strong>
                <small>
                  {[kinds.length > 1 && KIND_LABELS[result.kind], result.note]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
            </li>
          ))}
        </ul>
        {ready && !results.length && (
          <p>
            {found.failed
              ? "Search isn’t working right now. Try again in a moment."
              : `Nothing called “${query}” in this catalog.`}
          </p>
        )}
      </div>
      <p className="dx-visually-hidden" role="status">
        {showList && ready ? (results.length ? `${results.length} results` : "No results") : ""}
      </p>
    </div>
  );
}
