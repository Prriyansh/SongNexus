"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { connectionsHref } from "../lib/links";
import type { Category } from "../lib/types";
import CategoryFilter from "./CategoryFilter";
import EntitySearch from "./EntitySearch";

type Props = { artist: string; categories: Category[] };

/** Where a connection web starts, and what counts in it. Stays put while the web changes. */
export default function ExplorerBar({ artist, categories }: Props) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  // Shown at once, so a second choice builds on the first while the page is still on its way.
  const [chosen, choose] = useOptimistic(categories);
  const go = (to: string, next: Category[]) =>
    startTransition(() => {
      choose(next);
      router.push(connectionsHref(to, next), { scroll: false });
    });
  return (
    <div className="dx-panel dx-explorer-bar" aria-busy={busy}>
      <EntitySearch
        label="Start from"
        placeholder="Another artist"
        kinds={["artist"]}
        onPick={(picked) => go(picked.id, chosen)}
      />
      <CategoryFilter value={chosen} onChange={(next) => go(artist, next)} />
      <div className="dx-busy" data-on={busy || undefined} aria-hidden="true" />
    </div>
  );
}
