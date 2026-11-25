import Link from "next/link";
import { Suspense } from "react";
import ShareButton from "@/discover/components/ShareButton";
import SixDegreesForm from "@/discover/components/SixDegreesForm";
import Tabs from "@/discover/components/Tabs";
import { Avatar, plural, Reasons, Section, Skeleton, SongLink } from "@/discover/components/parts";
import { surprisePairs } from "@/discover/lib/browse";
import { sixDegreesHref, type SixDegreesState } from "@/discover/lib/links";
import { pageMetadata } from "@/discover/lib/metadata";
import { playlistOf, playlistText } from "@/discover/lib/playlist";
import { artistsIn, oneOf } from "@/discover/lib/query";
import { graph, searchPaths } from "@/discover/lib/server";
import { entityHref, parseCategories, type ArtistRef, type FoundPath } from "@/discover/lib/types";
import { artistRef } from "@/discover/lib/words";

export const metadata = pageMetadata(
  "Six Degrees",
  "Pick two artists and see the chain of people who connect them, with the real credit behind every step.",
  "/discover/six-degrees",
);

const MAX_AVOID = 12;
const EXAMPLES = 4;

function Chain({ artists }: { artists: ArtistRef[] }) {
  return (
    <ol className="dx-chain" aria-label="Artists on this path">
      {artists.map((artist) => (
        <li key={artist.id}>
          <Link href={entityHref({ kind: "artist", id: artist.id })} prefetch={false}>
            <Avatar id={artist.id} name={artist.name} photo={artist.photo} size={84} eager />
            <span>{artist.name}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function Steps({ path, state }: { path: FoundPath; state: SixDegreesState }) {
  return (
    <ol className="dx-steps">
      {path.steps.map((step, i) => (
        <li key={step.to.id}>
          <div className="dx-step-who">
            <strong>
              {step.from.name} <span aria-hidden="true">→</span>
              <span className="dx-visually-hidden"> to </span> {step.to.name}
            </strong>
            {i < path.steps.length - 1 && (
              <Link
                className="dx-text-button"
                href={sixDegreesHref({
                  ...state,
                  avoid: [...state.avoid, step.to].slice(-MAX_AVOID),
                })}
                prefetch={false}
                scroll={false}
              >
                Go around {step.to.name}
              </Link>
            )}
          </div>
          <Reasons reasons={step.reasons} total={step.reasonCount} />
        </li>
      ))}
    </ol>
  );
}

function Playlist({ path }: { path: FoundPath }) {
  const songs = playlistOf(path);
  if (songs.length < 2) return null;
  return (
    <div className="dx-playlist">
      <div className="dx-line">
        <div>
          <h3>Hear the path</h3>
          <p>One song from each step that has one.</p>
        </div>
        <ShareButton label="Copy the list" text={playlistText(songs)} />
      </div>
      <div className="dx-grid">
        {songs.map((song) => (
          <SongLink key={song.id} song={song} />
        ))}
      </div>
    </div>
  );
}

function Route({ path, state }: { path: FoundPath; state: SixDegreesState }) {
  return (
    <>
      <Chain artists={path.artists} />
      <Steps path={path} state={state} />
      <Playlist path={path} />
    </>
  );
}

function Examples({ pairs }: { pairs: ReturnType<typeof surprisePairs> }) {
  return (
    <Section title="Try one of these">
      <div className="dx-pairs">
        {pairs.slice(0, EXAMPLES).map(({ from, to, steps }) => (
          <Link
            key={`${from.id}${to.id}`}
            className="dx-pair"
            href={sixDegreesHref({ from, to })}
            prefetch={false}
            scroll={false}
          >
            <span className="dx-pair-faces">
              <Avatar id={from.id} name={from.name} photo={from.photo} size={60} />
              <Avatar id={to.id} name={to.name} photo={to.photo} size={60} />
            </span>
            <span>
              <strong>
                {from.name} and {to.name}
              </strong>
              <small>{plural(steps, "step")} apart</small>
            </span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

type Search = PageProps<"/discover/six-degrees">["searchParams"];

async function Content({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const g = graph();
  const { artistAt } = g.catalog;
  const [from] = artistsIn(query, "from", artistAt, 1);
  const [to] = artistsIn(query, "to", artistAt, 1);
  const avoid = artistsIn(query, "avoid", artistAt, MAX_AVOID).filter(
    (a) => a !== from && a !== to,
  );
  const ref = (at: number | undefined) => (at === undefined ? null : artistRef(g.catalog, at));
  const state: SixDegreesState = {
    from: ref(from),
    to: ref(to),
    categories: parseCategories(oneOf(query, "via")),
    order: oneOf(query, "order") === "strongest" ? "strongest" : "shortest",
    avoid: avoid.map((at) => artistRef(g.catalog, at)),
  };
  const result =
    from !== undefined && to !== undefined
      ? searchPaths(g, from, to, state.categories, state.order, avoid)
      : null;
  const pairs = surprisePairs(g);
  return (
    <>
      <SixDegreesForm key={`${from}|${to}`} state={state} surprises={pairs} />
      {!result && <Examples pairs={pairs} />}
      {result?.status === "same-artist" && (
        <p className="dx-panel dx-hint" role="status">
          That’s the same artist twice. Pick two different ones.
        </p>
      )}
      {result?.status === "not-connected" && (
        <p className="dx-panel dx-hint" role="status">
          No connection within six steps in this catalog
          {avoid.length > 0 && ", going around the artists you left out"}. Counting more kinds of
          connection may find one.
        </p>
      )}
      {result?.status === "ok" && (
        <section className="dx-panel" aria-label="The path">
          <header className="dx-line">
            <div>
              <h2 className="dx-answer">{plural(result.paths[0].steps.length, "step")} apart</h2>
              <p>
                {state.order === "shortest"
                  ? "The fewest steps through credits in this catalog. Closer working relationships win ties."
                  : "The closest working relationships in this catalog, within six steps."}
              </p>
            </div>
            <ShareButton label="Share" />
          </header>
          <Tabs
            label="Other ways between them"
            tabs={result.paths.map((path, i) => ({
              key: path.artists.map((a) => a.id).join(),
              label: `${i === 0 ? "Best path" : `Another way ${i > 1 ? i : ""}`.trim()} · ${plural(path.steps.length, "step")}`,
              content: <Route path={path} state={state} />,
            }))}
          />
        </section>
      )}
    </>
  );
}

export default function SixDegreesPage({ searchParams }: PageProps<"/discover/six-degrees">) {
  return (
    <>
      <header className="dx-head">
        <h1>Six Degrees</h1>
        <p>Two artists, and the people who connect them. Every step is a real credit.</p>
      </header>
      <Suspense fallback={<Skeleton panels={2} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
