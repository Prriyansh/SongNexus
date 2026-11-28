"use client";

import { Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { step } from "../api";
import { longDate } from "../lib/days";
import { GAMES_KEY, MAX_CHAIN, resultsIn, scoreText, withResult, type Puzzle } from "../lib/game-info";
import { sixDegreesHref } from "../lib/links";
import { readStored, writeStored } from "../lib/stored";
import { entityHref, type ArtistRef, type EntityRef, type Reason } from "../lib/types";
import EntitySearch from "./EntitySearch";
import ShareButton from "./ShareButton";
import { Avatar, Reasons } from "./parts";
import { useStored } from "./useStored";

type Step = { artist: ArtistRef; reason: Reason };

function Face({ artist }: { artist: ArtistRef }) {
  return (
    <Link className="dx-connect-face" href={entityHref({ kind: "artist", id: artist.id })} prefetch={false}>
      <Avatar id={artist.id} name={artist.name} photo={artist.photo} size={64} />
      <span>{artist.name}</span>
    </Link>
  );
}

const refOf = (picked: EntityRef): ArtistRef => ({
  id: picked.id,
  name: picked.name,
  note: picked.note,
  listeners: null,
  photo: picked.image ?? null,
});

/** Connect: name someone the last artist worked with, until you reach the target. */
export default function ConnectGame({ day, puzzle }: { day: number; puzzle: Puzzle }) {
  const done = resultsIn(useStored(GAMES_KEY)).connect[String(day)];
  const [steps, setSteps] = useState<Step[]>([]);
  const [misses, setMisses] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { start, target, par } = puzzle;
  const last = steps.length ? steps[steps.length - 1].artist : start;
  const finish = (score: number, gaveUp: boolean, answers: string[]) =>
    writeStored(GAMES_KEY, withResult(readStored(GAMES_KEY), "connect", day, { score, gaveUp, submitted: false, answers }));

  const guess = async (picked: EntityRef) => {
    setBusy(true);
    setMessage(null);
    try {
      const found = await step(day, last.id, picked.id);
      if (!found.linked) {
        setMisses((n) => n + 1);
        setMessage(`No credit links ${last.name} and ${picked.name} in this catalog. Try someone else.`);
        return;
      }
      const next = [...steps, { artist: refOf(picked), reason: found.reason! }];
      setSteps(next);
      if (found.reached) finish(next.length, false, [start.id, ...next.map((s) => s.artist.id)]);
    } catch {
      setMessage("That didn’t go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const shared = done && !done.gaveUp && `Song Nexus Connect, ${longDate(day)}: ${start.name} to ${target.name} in ${scoreText("connect", done.score)} (par ${par}).`;
  return (
    <section className="dx-panel dx-connect" aria-label="Connect">
      <div className="dx-connect-ends">
        <Face artist={start} />
        <span className="dx-connect-par">
          to
          <small>
            par {par} {par === 1 ? "step" : "steps"}
          </small>
        </span>
        <Face artist={target} />
      </div>
      {steps.length > 0 && (
        <ol className="dx-steps" aria-label="Your chain">
          {steps.map((s, i) => (
            <li key={`${s.artist.id}-${i}`}>
              <strong>
                {i + 1}. {s.artist.name}
              </strong>
              <Reasons reasons={[s.reason]} total={1} />
            </li>
          ))}
        </ol>
      )}
      {done ? (
        <div className="dx-connect-end" role="status">
          {done.gaveUp ? (
            <p className="dx-lead">You stopped here. The shortest way takes {par} steps.</p>
          ) : (
            <p className="dx-lead">
              You connected them in {scoreText("connect", done.score)}
              {done.score <= par ? ", as few as possible." : `; it can be done in ${par}.`}
            </p>
          )}
          <div className="dx-story-actions">
            <Link className="dx-button dx-quiet" href={sixDegreesHref({ from: start, to: target })} prefetch={false}>
              See the shortest paths
            </Link>
            {shared && <ShareButton label="Copy my result" text={shared} />}
          </div>
        </div>
      ) : (
        <>
          {steps.length < MAX_CHAIN ? (
            <EntitySearch
              label={`Who did ${last.name} work with?`}
              placeholder="An artist, producer or musician"
              kinds={["artist"]}
              onPick={(picked) => void (busy || guess(picked))}
            />
          ) : (
            <p className="dx-hint">That’s as long as a chain can be. Undo a step to try another way.</p>
          )}
          {message && (
            <p className="dx-hint" role="alert">
              {message}
            </p>
          )}
          <div className="dx-story-actions">
            {steps.length > 0 && (
              <button type="button" className="dx-button dx-quiet" onClick={() => setSteps(steps.slice(0, -1))}>
                <Undo2 size={16} aria-hidden="true" /> Undo the last step
              </button>
            )}
            <button type="button" className="dx-button dx-quiet" onClick={() => finish(MAX_CHAIN + 1, true, [])}>
              Show me the answer
            </button>
          </div>
          {misses > 0 && <p className="dx-hint">Misses so far: {misses}.</p>}
        </>
      )}
    </section>
  );
}
