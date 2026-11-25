"use client";

import { CATEGORIES, CATEGORY_LABELS, type Category } from "../lib/types";

/** Which kinds of connection count. The last one left can't be turned off. */
export default function CategoryFilter({ value, onChange }: { value: readonly Category[]; onChange: (next: Category[]) => void }) {
  return (
    <fieldset className="dx-filter">
      <legend>Connections that count</legend>
      {CATEGORIES.map((category) => {
        const on = value.includes(category);
        return (
          <label key={category} data-category={category}>
            <input
              type="checkbox"
              checked={on}
              disabled={on && value.length === 1}
              onChange={() => onChange(CATEGORIES.filter((c) => (c === category ? !on : value.includes(c))))}
            />
            <span>{CATEGORY_LABELS[category]}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
