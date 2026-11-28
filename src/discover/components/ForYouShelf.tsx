"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { forYou, forYouQuery } from "../api";
import { topIn, TOP_KEY } from "../lib/account-data";
import { favouritesIn, hiddenArtistsIn, hiddenIn, HIDDEN_KEY, PROFILE_KEY, readStored, writeStored } from "../lib/stored";
import type { ForYouPick } from "../lib/types";
import { AppLink, ArtistCard, Skeleton } from "./parts";
import { useStored } from "./useStored";

type Result = { query: string; picks: ForYouPick[] | null };

function why(pick: ForYouPick): string {
  return pick.because ? `Because you like ${pick.because.name}` : `Known for ${pick.genre!.name}`;
}

/** Leaves an artist out of suggestions from now on. */
function hide(pick: ForYouPick) {
  const { id, name, note, photo } = pick.artist;
  writeStored(HIDDEN_KEY, [...hiddenArtistsIn(readStored(HIDDEN_KEY)), { id, name, note, photo }]);
}

/** Artists to try, from your Top 5 and About Me favourites; without any, how to add some. */
export default function ForYouShelf() {
  const profile = useStored(PROFILE_KEY);
  const hidden = useStored(HIDDEN_KEY);
  const top = useStored(TOP_KEY);
  const [favourites, skip] = useMemo(() => {
    const found = favouritesIn(profile);
    const artists = [...new Set([...topIn(top).map((v) => v.id), ...found.artists])];
    return [{ ...found, artists }, hiddenIn(hidden)];
  }, [profile, hidden, top]);
  const query = favourites.artists.length || favourites.genres.length ? String(forYouQuery(favourites, skip)) : "";
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    forYou(favourites, skip, controller.signal)
      .then(({ picks }) => setResult({ query, picks }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ query, picks: null });
      });
    return () => controller.abort();
    // `query` stands for the favourites and hidden artists it is made from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, attempt]);

  if (!query)
    return (
      <p className="dx-hint">
        Add the artists, songs and genres you love in <AppLink href="/about">About Me</AppLink>, and
        this fills with artists connected to them.
      </p>
    );
  if (result?.query !== query) return <Skeleton panels={1} />;
  if (!result.picks)
    return (
      <p className="dx-hint" role="alert">
        Suggestions didn’t load.{" "}
        <button type="button" className="dx-text-button" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </p>
    );
  if (!result.picks.length)
    return <p className="dx-hint">None of your favourites are in this catalog yet, so there’s nothing to suggest.</p>;
  return (
    <div className="dx-portraits">
      {result.picks.map((pick) => (
        <div key={pick.artist.id} className="dx-pick">
          <ArtistCard artist={pick.artist} />
          <small title={pick.reason?.text}>{why(pick)}</small>
          <button type="button" className="dx-icon-button" aria-label={`Don’t suggest ${pick.artist.name}`} onClick={() => hide(pick)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
