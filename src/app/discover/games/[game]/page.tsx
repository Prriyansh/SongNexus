import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import ConnectGame from "@/discover/components/ConnectGame";
import Leaderboard from "@/discover/components/Leaderboard";
import QuizGame from "@/discover/components/QuizGame";
import { Skeleton } from "@/discover/components/parts";
import { dateOfDay, dayIn, LAUNCH_DAY, longDate, todayNumber } from "@/discover/lib/days";
import { GAME_INFO, gameHref, isGame, type Game } from "@/discover/lib/game-info";
import { puzzleOf, quizOf } from "@/discover/lib/games";
import { pageMetadata } from "@/discover/lib/metadata";
import { oneOf } from "@/discover/lib/query";
import { graph } from "@/discover/lib/server";

type Props = PageProps<"/discover/games/[game]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game } = await params;
  if (!isGame(game)) return { title: "Games · Song Nexus" };
  return pageMetadata(GAME_INFO[game].name, GAME_INFO[game].rule, `/discover/games/${game}`);
}

function Play({ game, day }: { game: Game; day: number }) {
  const g = graph();
  if (game === "connect") {
    const puzzle = puzzleOf(g, day);
    return puzzle ? (
      <ConnectGame key={day} day={day} puzzle={puzzle} />
    ) : (
      <p className="dx-panel dx-hint">This catalog has no Connect puzzle for this day.</p>
    );
  }
  const questions = quizOf(g, game, day);
  return questions.length ? (
    <QuizGame key={day} game={game} day={day} questions={questions} />
  ) : (
    <p className="dx-panel dx-hint">This catalog has no questions for this day.</p>
  );
}

async function Content({ params, searchParams }: Props) {
  const { game } = await params;
  if (!isGame(game)) notFound();
  const asked = oneOf(await searchParams, "day");
  await connection();
  const today = todayNumber();
  const day = dayIn(asked, today);
  return (
    <>
      <header className="dx-game-title">
        <h2>{GAME_INFO[game].name}</h2>
        <p>{GAME_INFO[game].rule}</p>
      </header>
      <nav className="dx-story-nav" aria-label="Other days">
        {day > LAUNCH_DAY ? (
          <Link className="dx-button dx-quiet" href={gameHref(game, dateOfDay(day - 1))} prefetch={false}>
            <ChevronLeft size={18} aria-hidden="true" /> The day before
          </Link>
        ) : (
          <span />
        )}
        <span className="dx-story-count">{day === today ? `Today, ${longDate(day)}` : longDate(day)}</span>
        {day < today ? (
          <Link className="dx-button dx-quiet" href={gameHref(game, dateOfDay(day + 1))} prefetch={false}>
            The day after <ChevronRight size={18} aria-hidden="true" />
          </Link>
        ) : (
          <span />
        )}
      </nav>
      <Play game={game} day={day} />
      <Leaderboard key={`${game}:${day}`} game={game} day={day} />
    </>
  );
}

export default function GamePage(props: Props) {
  return (
    <>
      <header className="dx-head">
        <h1>
          <Link href="/discover/games">Games</Link>
        </h1>
        <p>Made from real credits, the same for everyone, new each day at midnight UTC.</p>
      </header>
      <Suspense fallback={<Skeleton panels={2} />}>
        <Content {...props} />
      </Suspense>
    </>
  );
}
