import { Suspense } from "react";
import ConnectionExplorer from "@/discover/components/ConnectionExplorer";
import ExplorerBar from "@/discover/components/ExplorerBar";
import { Skeleton } from "@/discover/components/parts";
import { popularArtists } from "@/discover/lib/browse";
import { connectionsHref } from "@/discover/lib/links";
import { pageMetadata } from "@/discover/lib/metadata";
import { artistsIn, oneOf } from "@/discover/lib/query";
import { graph, neighborhood } from "@/discover/lib/server";
import { OPEN_LIMIT, parseCategories } from "@/discover/lib/types";

export const metadata = pageMetadata(
  "Collaborators",
  "Start from one artist and open the web of who they worked with, with the credits behind every link.",
  "/discover/connections",
);

const START_LIMIT = 22;
const MAX_OPENED = 8;

type Search = PageProps<"/discover/connections">["searchParams"];

async function Content({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const g = graph();
  const { artists, artistAt } = g.catalog;
  const asked = oneOf(query, "artist").toLowerCase();
  const artist = artistAt.get(asked || popularArtists(g.catalog, 1)[0].id);
  if (artist === undefined) {
    return (
      <p className="dx-panel dx-hint" role="status">
        That artist isn’t in this catalog. <a href={connectionsHref("", [])}>Start from another</a>.
      </p>
    );
  }
  const categories = parseCategories(oneOf(query, "via"));
  const opened = artistsIn(query, "open", artistAt, MAX_OPENED).filter((at) => at !== artist);
  return (
    <>
      <ExplorerBar artist={artists[artist].id} categories={categories} />
      <ConnectionExplorer
        key={`${artists[artist].id}|${categories}`}
        start={neighborhood(g, artist, categories, START_LIMIT)}
        opened={opened.map((at) => neighborhood(g, at, categories, OPEN_LIMIT))}
        categories={categories}
      />
    </>
  );
}

export default function ConnectionsPage({ searchParams }: PageProps<"/discover/connections">) {
  return (
    <>
      <header className="dx-head">
        <h1>Collaborators</h1>
        <p>
          The people an artist worked with, from real credits. Pick someone to see why, and open
          their connections to keep going.
        </p>
      </header>
      <Suspense fallback={<Skeleton panels={2} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
