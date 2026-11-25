import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import SixDegreesForm from "@/discover/components/SixDegreesForm";
import { Avatar, Loading, plural, Reasons, Section } from "@/discover/components/parts";
import { surprisePairs } from "@/discover/lib/browse";
import { sixDegreesHref, type SixDegreesState } from "@/discover/lib/links";
import type { PathOrder } from "@/discover/lib/paths";
import { graph, searchPaths } from "@/discover/lib/server";
import { entityHref, parseCategories, type FoundPath } from "@/discover/lib/types";
import { artistRef } from "@/discover/lib/words";

export const metadata: Metadata = {
  title: "Six Degrees · Song Nexus",
  description: "Find the chain of real credits between two artists.",
};

const MAX_AVOID = 12;

function Steps({ path, state }: { path: FoundPath; state: SixDegreesState }) {
  return (
    <ol className="dx-steps">
      {path.steps.map((step, i) => (
        <li key={step.to.id}>
          <div className="dx-step-who">
            <Link href={entityHref({ kind: "artist", id: step.from.id })}>{step.from.name}</Link>
            <span aria-hidden="true">→</span>
            <Link href={entityHref({ kind: "artist", id: step.to.id })}>{step.to.name}</Link>
            {i < path.steps.length - 1 && (
              <Link className="dx-small-link" href={sixDegreesHref({ ...state, avoid: [...state.avoid, step.to].slice(-MAX_AVOID) })} scroll={false}>
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

/** One real song per step, where the step is about a song. */
function Mixtape({ path }: { path: FoundPath }) {
  const songs = path.steps.flatMap((step) => {
    const song = step.reasons.find((r) => r.subject?.kind === "song")?.subject;
    return song ? [song] : [];
  }).filter((song, i, all) => all.findIndex((s) => s.id === song.id) === i);
  if (songs.length < 2) return null;
  return (
    <Section title="The path as a playlist" note="One song from each step that has one.">
      <ol className="dx-tracks">
        {songs.map((song) => <li key={song.id}><Link href={entityHref(song)}><strong>{song.name}</strong><small>{song.note}</small></Link></li>)}
      </ol>
    </Section>
  );
}

function Chain({ path }: { path: FoundPath }) {
  return (
    <ul className="dx-chain" aria-label="Artists on this path">
      {path.artists.map((artist) => (
        <li key={artist.id}>
          <Link href={entityHref({ kind: "artist", id: artist.id })}><Avatar id={artist.id} name={artist.name} size={64} /><span>{artist.name}</span></Link>
        </li>
      ))}
    </ul>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/discover/six-degrees">["searchParams"] }) {
  const query = await searchParams;
  const one = (key: string) => { const value = query[key]; return (Array.isArray(value) ? value[0] : value) ?? ""; };
  const g = graph();
  const find = (id: string) => g.catalog.artistAt.get(id.toLowerCase());
  const [from, to] = [find(one("from")), find(one("to"))];
  const avoid = one("avoid").split(",").slice(0, MAX_AVOID).map(find).filter((at): at is number => at !== undefined && at !== from && at !== to);
  const order: PathOrder = one("order") === "strongest" ? "strongest" : "shortest";
  const state: SixDegreesState = {
    from: from === undefined ? null : artistRef(g.catalog, from),
    to: to === undefined ? null : artistRef(g.catalog, to),
    categories: parseCategories(one("via")),
    order,
    avoid: avoid.map((at) => artistRef(g.catalog, at)),
  };
  const result = from !== undefined && to !== undefined ? searchPaths(g, from, to, state.categories, order, avoid) : null;
  return (
    <>
      <SixDegreesForm state={state} surprises={surprisePairs(g)} />
      {!result && <p className="dx-hint">Pick two artists, or try “Surprise me”.</p>}
      {result?.status === "same-artist" && <p className="dx-hint" role="status">That’s the same artist twice. Pick two different ones.</p>}
      {result?.status === "not-connected" && (
        <p className="dx-hint" role="status">
          No connection within six steps in this catalog{avoid.length ? ", going around the artists you left out" : ""}. Turning on more kinds of connection may find one.
        </p>
      )}
      {result?.status === "ok" && (
        <>
          <Section title={`${plural(result.paths[0].steps.length, "step")} apart`} note={order === "shortest" ? "The fewest steps through credits in our data; closer working relationships win ties." : "The closest working relationships in our data, within six steps."}>
            <Chain path={result.paths[0]} />
            <Steps path={result.paths[0]} state={state} />
          </Section>
          <Mixtape path={result.paths[0]} />
          {result.paths.slice(1).map((path, i) => (
            <Section key={i} title={`Another way: ${plural(path.steps.length, "step")}`} note={path.artists.map((a) => a.name).join(" → ")}>
              <details className="dx-details"><summary>Show the credits</summary><Steps path={path} state={state} /></details>
            </Section>
          ))}
        </>
      )}
    </>
  );
}

export default function SixDegreesPage({ searchParams }: PageProps<"/discover/six-degrees">) {
  return (
    <>
      <header className="dx-head">
        <h1>Six Degrees</h1>
        <p>Two artists, and the people who connect them: every step is a real credit you can open.</p>
      </header>
      <Suspense fallback={<Loading />}><Content searchParams={searchParams} /></Suspense>
    </>
  );
}
