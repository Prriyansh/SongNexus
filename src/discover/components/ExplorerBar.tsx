"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { connectionsHref } from "../lib/links";
import type { Category } from "../lib/types";
import CategoryFilter from "./CategoryFilter";
import EntitySearch from "./EntitySearch";

type Props = { artist: string; categories: Category[] };

/** Where a connection web starts, and what counts in it. Stays put while the web changes. */
export default function ExplorerBar({ artist, categories }: Props) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const go = (href: string) => startTransition(() => router.push(href, { scroll: false }));
  return (
    <div className="dx-panel dx-explorer-bar" aria-busy={busy}>
      <EntitySearch
        label="Start from"
        placeholder="Another artist"
        kinds={["artist"]}
        onPick={(picked) => go(connectionsHref(picked.id, categories))}
      />
      <CategoryFilter value={categories} onChange={(next) => go(connectionsHref(artist, next))} />
      <div className="dx-busy" data-on={busy || undefined} aria-hidden="true" />
    </div>
  );
}
