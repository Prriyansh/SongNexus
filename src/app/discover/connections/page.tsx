import type { Metadata } from "next";
import { Suspense } from "react";
import ConnectionExplorer from "@/discover/components/ConnectionExplorer";
import { Loading, Missing } from "@/discover/components/parts";
import { popularArtists } from "@/discover/lib/browse";
import { graph, neighborhood } from "@/discover/lib/server";
import { parseCategories } from "@/discover/lib/types";

export const metadata: Metadata = {
  title: "Collaborators · Song Nexus",
  description: "Start from one artist and open the web of who they worked with.",
};

const START_LIMIT = 22;

async function Content({ searchParams }: { searchParams: PageProps<"/discover/connections">["searchParams"] }) {
  const query = await searchParams;
  const one = (key: string) => { const value = query[key]; return (Array.isArray(value) ? value[0] : value) ?? ""; };
  const g = graph();
  const id = one("artist").toLowerCase() || popularArtists(g.catalog, 1)[0].id;
  const artist = g.catalog.artistAt.get(id);
  if (artist === undefined) return <Missing what="artist" />;
  const categories = parseCategories(one("via"));
  return <ConnectionExplorer key={`${id}|${categories}`} start={neighborhood(g, artist, categories, START_LIMIT)} categories={categories} />;
}

export default function ConnectionsPage({ searchParams }: PageProps<"/discover/connections">) {
  return (
    <>
      <header className="dx-head">
        <h1>Collaborators</h1>
        <p>The people an artist worked with, from real credits. Pick someone to see why, and open their connections to keep going.</p>
      </header>
      <Suspense fallback={<Loading />}><Content searchParams={searchParams} /></Suspense>
    </>
  );
}
