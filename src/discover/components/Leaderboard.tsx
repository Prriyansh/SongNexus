"use client";

import { useEffect, useState } from "react";
import { board, submitScore, type Board } from "../api";
import {
  GAMES_KEY,
  PLAYER_KEY,
  resultsIn,
  scoreText,
  storedPlayer,
  withResult,
  type Game,
} from "../lib/game-info";
import { readStored, writeStored } from "../lib/stored";
import { useStored } from "./useStored";

/** This browser's player ID, made the first time it's needed. */
function playerId(): string {
  const known = storedPlayer(readStored(PLAYER_KEY));
  if (known) return known;
  const made = crypto.randomUUID();
  writeStored(PLAYER_KEY, made);
  return made;
}

type State = { board: Board | null; failed: string | null; version: number };

/** The day's best scores, and a way onto them once the game is finished here. */
export default function Leaderboard({ game, day }: { game: Game; day: number }) {
  const own = resultsIn(useStored(GAMES_KEY))[game][String(day)];
  const [state, setState] = useState<State>({ board: null, failed: null, version: 0 });
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    board(game, day, storedPlayer(readStored(PLAYER_KEY)), controller.signal)
      .then((found) => setState((s) => ({ ...s, board: found, failed: null })))
      .catch(() => {
        if (!controller.signal.aborted)
          setState((s) => ({ ...s, failed: "The leaderboard isn’t available right now." }));
      });
    return () => controller.abort();
  }, [game, day, state.version]);

  const send = async () => {
    setSending(true);
    try {
      await submitScore(game, day, playerId(), name, own.answers);
      writeStored(GAMES_KEY, withResult(readStored(GAMES_KEY), game, day, { ...own, submitted: true }));
      setState((s) => ({ ...s, version: s.version + 1 }));
    } catch (error) {
      setState((s) => ({ ...s, failed: (error as Error).message }));
    } finally {
      setSending(false);
    }
  };

  const { board: found } = state;
  return (
    <section className="dx-panel dx-board" aria-label="Leaderboard">
      <header className="dx-section-head">
        <h2>Leaderboard</h2>
        <p>The day’s best scores; on a tie, whoever finished first.</p>
      </header>
      {state.failed && (
        <p className="dx-hint" role="alert">
          {state.failed}
        </p>
      )}
      {found &&
        (found.entries.length ? (
          <ol className="dx-board-list">
            {found.entries.map((entry, i) => (
              <li key={i} aria-current={found.mine === i ? "true" : undefined}>
                <span>{entry.name}</span>
                <strong>{scoreText(game, entry.score)}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <p className="dx-hint">No one is on it yet.</p>
        ))}
      {found?.mine != null && (
        <p className="dx-hint">
          You’re {(found.mine + 1).toLocaleString("en")} of {found.total.toLocaleString("en")}.
        </p>
      )}
      {own && !own.gaveUp && !own.submitted && own.answers.length > 0 && (
        <form
          className="dx-board-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor={`board-name-${game}`}>Your name on the board</label>
          <div className="dx-ask-row">
            <div className="dx-field">
              <input
                id={`board-name-${game}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={24}
                required
                autoComplete="nickname"
              />
            </div>
            <button type="submit" className="dx-button" disabled={sending}>
              Add my score
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
