"use client";

import { useMemo } from "react";
import { GAMES_KEY, resultsIn, scoreText, statsOf, streakOf, type Game } from "../lib/game-info";
import { useStored } from "./useStored";

/** How a game went on a day in this browser: its score, or that it's still to play. */
export function GameBadge({ game, day }: { game: Game; day: number }) {
  const result = resultsIn(useStored(GAMES_KEY))[game][String(day)];
  if (!result) return <span className="dx-badge">To play</span>;
  return (
    <span className="dx-badge" data-done="true">
      {result.gaveUp ? "Stopped" : `Done · ${scoreText(game, result.score)}`}
    </span>
  );
}

/** The streak and totals, from the games played in this browser. */
export function GameStats({ today }: { today: number }) {
  const stored = useStored(GAMES_KEY);
  const [streak, stats] = useMemo(() => {
    const results = resultsIn(stored);
    return [streakOf(results, today), statsOf(results)];
  }, [stored, today]);
  const items = [
    { value: streak, what: streak === 1 ? "day in a row" : "days in a row" },
    { value: stats.days, what: stats.days === 1 ? "day played" : "days played" },
    { value: stats.wins, what: stats.wins === 1 ? "Connect solved" : "Connects solved" },
    { value: stats.perfect, what: stats.perfect === 1 ? "perfect quiz" : "perfect quizzes" },
  ];
  return (
    <ul className="dx-tally" aria-label="Your games">
      {items.map(({ value, what }) => (
        <li key={what}>
          <strong>{value.toLocaleString("en")}</strong> {what}
        </li>
      ))}
    </ul>
  );
}
