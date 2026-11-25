"use client";

import { SlidersHorizontal } from "lucide-react";
import { CATEGORIES, CATEGORY_LABELS, isDefaultCategories, type Category } from "../lib/types";

type Props = { value: readonly Category[]; onChange: (next: Category[]) => void };

/** Which kinds of connection count, folded away until wanted. The last one left can't be turned off. */
export default function CategoryFilter({ value, onChange }: Props) {
  const summary = isDefaultCategories(value)
    ? "Choose which connections count"
    : `${value.length} of ${CATEGORIES.length} kinds of connection count`;
  return (
    <details className="dx-options">
      <summary>
        <SlidersHorizontal size={15} aria-hidden="true" />
        {summary}
      </summary>
      <fieldset className="dx-filter">
        <legend className="dx-visually-hidden">Connections that count</legend>
        {CATEGORIES.map((category) => {
          const on = value.includes(category);
          const toggled = CATEGORIES.filter((c) => (c === category ? !on : value.includes(c)));
          return (
            <label key={category} data-category={category}>
              <input
                type="checkbox"
                checked={on}
                disabled={on && value.length === 1}
                onChange={() => onChange(toggled)}
              />
              <span>{CATEGORY_LABELS[category]}</span>
            </label>
          );
        })}
      </fieldset>
    </details>
  );
}
