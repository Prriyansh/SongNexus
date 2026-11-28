"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { communities, community, joinCommunity, leaveCommunity, type CommunityView } from "../api";
import { topIn, TOP_KEY } from "../lib/account-data";
import { aroundHref } from "../lib/places";
import { favouritesIn, PROFILE_KEY } from "../lib/stored";
import { ArtistLink, plural, Section, Skeleton } from "./parts";
import ShareButton from "./ShareButton";
import { keyOf, myArtists, useListening } from "./useListening";
import { useStored } from "./useStored";

/** Up to this many of your artists are shared with a community. */
export const SHARED = 25;

type Overview = { joined: CommunityView[]; campus: string | null; signedIn: boolean };

function Chart({ view }: { view: CommunityView }) {
  if (view.needed > 0)
    return (
      <p className="dx-hint">
        The chart opens when {plural(view.needed, "more member")} share their artists, so no one’s taste can be picked out.
      </p>
    );
  return (
    <>
      <ol className="dx-heard">
        {view.chart.map((row) => (
          <li key={row.artist.id}>
            <ArtistLink artist={row.artist}>{plural(row.members, "member")}</ArtistLink>
          </li>
        ))}
      </ol>
      {view.recap && (
        <div className="dx-recap">
          <h3>This week</h3>
          <ul className="dx-plain">
            {view.recap.rose.map((m) => (
              <li key={`r${m.artist.id}`}>
                <ArrowUp size={14} aria-label="Rose" /> {m.artist.name}, {m.from} to {m.to}
              </li>
            ))}
            {view.recap.fell.map((m) => (
              <li key={`f${m.artist.id}`}>
                <ArrowDown size={14} aria-label="Fell" /> {m.artist.name}, {m.from} to {m.to}
              </li>
            ))}
            {view.recap.entered.map((a) => (
              <li key={`e${a.id}`}>New: {a.name}</li>
            ))}
            {view.recap.left.map((a) => (
              <li key={`l${a.id}`}>Left the chart: {a.name}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

type CardProps = {
  view: CommunityView;
  signedIn: boolean;
  share: () => Promise<void>;
  leave: () => Promise<void>;
};

function Card({ view, signedIn, share, leave }: CardProps) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    await action();
    setBusy(false);
  };
  return (
    <section className="dx-panel" aria-label={view.name}>
      <header className="dx-line">
        <div>
          <h2>
            <Link href={aroundHref(view.id)} prefetch={false}>
              {view.name}
            </Link>
          </h2>
          <p>
            {view.kind === "campus" ? "Campus" : "Country"} · {plural(view.members, "member")}, {view.sharing} sharing
          </p>
        </div>
        <div className="dx-story-actions">
          {signedIn && (
            <button type="button" className="dx-button" disabled={busy} onClick={() => void run(share)}>
              {view.joined ? "Share my artists again" : "Join and share my artists"}
            </button>
          )}
          {view.joined && (
            <button type="button" className="dx-button dx-quiet" disabled={busy} onClick={() => void run(leave)}>
              Leave
            </button>
          )}
        </div>
      </header>
      <Chart view={view} />
    </section>
  );
}

/** Around You: charts for a campus or a country, from members who share their artists. */
// The countries come from the server: browsers name and sort them a little differently.
export default function AroundYou({ looking, countries }: { looking: string | null; countries: [code: string, name: string][] }) {
  const router = useRouter();
  const { connected, heard } = useListening();
  const favourites = favouritesIn(useStored(PROFILE_KEY)).artists;
  const top = topIn(useStored(TOP_KEY)).map((v) => v.id);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [viewed, setViewed] = useState<CommunityView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [country, setCountry] = useState("US");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const failed = (error: Error) => {
      if (!controller.signal.aborted) setProblem(error.message);
    };
    communities(controller.signal).then(setOverview).catch(failed);
    if (looking) community(looking, controller.signal).then(setViewed).catch(failed);
    return () => controller.abort();
  }, [looking, version]);

  const mine = () => myArtists(connected, heard, favourites, top).slice(0, SHARED);
  const act = (action: () => Promise<unknown>) => async () => {
    try {
      await action();
      setProblem(null);
      setVersion((v) => v + 1);
    } catch (error) {
      setProblem((error as Error).message);
    }
  };
  const card = (view: CommunityView) => (
    <Card
      key={view.id}
      view={view}
      signedIn={overview?.signedIn ?? false}
      share={act(() => joinCommunity(view.id, mine()))}
      leave={act(() => leaveCommunity(view.id))}
    />
  );
  const waiting = connected.some((c) => !heard[keyOf(c)]);
  const campusJoined = overview?.joined.some((v) => v.id === overview.campus);

  return (
    <>
      {problem && (
        <p className="dx-panel dx-hint" role="alert">
          {problem}
        </p>
      )}
      <form
        className="dx-search dx-ask"
        onSubmit={(event) => {
          event.preventDefault();
          router.push(aroundHref(`country:${country}`));
        }}
      >
        <label htmlFor="around-country">Look around a country</label>
        <div className="dx-ask-row">
          <select id="around-country" className="dx-select" value={country} onChange={(event) => setCountry(event.target.value)}>
            {countries.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          <button type="submit" className="dx-button">
            Look
          </button>
        </div>
      </form>
      {looking && !viewed && !problem && <Skeleton panels={1} />}
      {viewed && (
        <>
          {card(viewed)}
          <ShareButton label="Share this chart" />
        </>
      )}
      {!overview && !problem && <Skeleton panels={1} />}
      {overview && !overview.signedIn && (
        <p className="dx-panel dx-hint">
          <Link href="/discover/you" prefetch={false}>
            Sign in on You
          </Link>{" "}
          to join your campus or a country and share your artists. Anyone can look around.
        </p>
      )}
      {overview?.campus && !campusJoined && (
        <Section title="Your campus" note={`Your account is from ${overview.campus.slice("campus:".length)}.`}>
          <button
            type="button"
            className="dx-button"
            disabled={waiting}
            onClick={() => void act(() => joinCommunity(overview.campus!, mine()))()}
          >
            Join {overview.campus.slice("campus:".length)} and share my artists
          </button>
        </Section>
      )}
      {overview?.signedIn && (
        <Section title="Your communities" note="What you share: your Top 5, then the artists you play most, then your favourites.">
          {overview.joined.length ? (
            overview.joined.filter((v) => v.id !== viewed?.id).map(card)
          ) : (
            <p className="dx-hint">None yet. Join your campus, or look around a country and join it.</p>
          )}
        </Section>
      )}
    </>
  );
}
