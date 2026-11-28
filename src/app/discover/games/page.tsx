import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { GameBadge, GameStats } from "@/discover/components/GameProgress";
import { Avatar, Section, Skeleton } from "@/discover/components/parts";
import { dateOfDay, LAUNCH_DAY, longDate, todayNumber } from "@/discover/lib/days";
import { GAME_INFO, gameHref, GAMES } from "@/discover/lib/game-info";
import { puzzleOf } from "@/discover/lib/games";
import { pageMetadata } from "@/discover/lib/metadata";
import { graph } from "@/discover/lib/server";

export const metadata = pageMetadata(
  "Games",
  "Three daily games made from real credits: connect two artists, check who made what, and find the missing link.",
  "/discover/games",
);

/** How far back the archive lists days on this page. */
const ARCHIVE_DAYS = 35;

async function Content() {
  await connection();
  const today = todayNumber();
  const puzzle = puzzleOf(graph(), today);
  const past = Array.from({ length: Math.min(ARCHIVE_DAYS, today - LAUNCH_DAY) }, (_, i) => today - 1 - i);
  return (
    <>
      <p className="dx-story-count">{longDate(today)}</p>
      <div className="dx-games">
        {GAMES.map((game) => (
          <Link key={game} className="dx-game" href={gameHref(game)} prefetch={false}>
            <span className="dx-game-head">
              <strong>{GAME_INFO[game].name}</strong>
              <GameBadge game={game} day={today} />
            </span>
            <small>{GAME_INFO[game].rule}</small>
            {game === "connect" && puzzle && (
              <span className="dx-game-faces" aria-label={`From ${puzzle.start.name} to ${puzzle.target.name}`}>
                <Avatar id={puzzle.start.id} name={puzzle.start.name} photo={puzzle.start.photo} size={44} />
                <ArrowRight size={18} aria-hidden="true" />
                <Avatar id={puzzle.target.id} name={puzzle.target.name} photo={puzzle.target.photo} size={44} />
              </span>
            )}
          </Link>
        ))}
      </div>
      <Section title="Your games" note="Kept in this browser only.">
        <GameStats today={today} />
      </Section>
      {past.length > 0 && (
        <Section title="Archive" note="Every day’s games since the first, for anyone who missed one.">
          <ul className="dx-archive">
            {past.map((day) => (
              <li key={day}>
                <span>{longDate(day)}</span>
                {GAMES.map((game) => (
                  <Link key={game} href={gameHref(game, dateOfDay(day))} prefetch={false}>
                    {GAME_INFO[game].name} <GameBadge game={game} day={day} />
                  </Link>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

export default function GamesPage() {
  return (
    <>
      <header className="dx-head">
        <h1>Games</h1>
        <p>Three games a day, made from real credits and the same for everyone. New ones at midnight UTC.</p>
      </header>
      <Suspense fallback={<Skeleton panels={2} />}>
        <Content />
      </Suspense>
    </>
  );
}
