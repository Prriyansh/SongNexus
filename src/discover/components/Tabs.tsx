"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type Tab = { key: string; label: string; content: ReactNode };

const STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };

/** Panels one at a time. With a single tab there is nothing to choose, so only its panel shows. */
export default function Tabs({ label, tabs }: { label: string; tabs: Tab[] }) {
  const id = useId();
  const [current, setCurrent] = useState(tabs[0]?.key);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // The tabs can change under the choice (a new search), so fall back to the first.
  const at = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === current),
  );

  if (!tabs.length) return null;
  if (tabs.length === 1) return tabs[0].content;

  const onKeyDown = (event: KeyboardEvent) => {
    const last = tabs.length - 1;
    const step = STEP[event.key];
    const to =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : step
            ? (at + step + last + 1) % (last + 1)
            : -1;
    if (to < 0) return;
    event.preventDefault();
    setCurrent(tabs[to].key);
    buttons.current[to]?.focus();
  };

  return (
    <div>
      <div className="dx-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(element) => {
              buttons.current[i] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === at}
            aria-controls={`${id}-panel`}
            tabIndex={i === at ? 0 : -1}
            onClick={() => setCurrent(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${at}`}
        key={tabs[at].key}
      >
        {tabs[at].content}
      </div>
    </div>
  );
}
