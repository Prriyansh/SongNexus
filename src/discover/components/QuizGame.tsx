"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { checkAnswer } from "../api";
import { longDate } from "../lib/days";
import { GAME_INFO, GAMES_KEY, resultsIn, scoreText, withResult, type Quiz, type QuizQuestion } from "../lib/game-info";
import { readStored, writeStored } from "../lib/stored";
import type { ArtistRef, Reason } from "../lib/types";
import ShareButton from "./ShareButton";
import { Avatar, Reasons, SongLink } from "./parts";
import { useStored } from "./useStored";

type Answered = { choice: string; correct: boolean; answer: ArtistRef; proof: Reason[] };

/** Credit check and The missing link: one question at a time, each answer shown with its proof. */
export default function QuizGame({ game, day, questions }: { game: Quiz; day: number; questions: QuizQuestion[] }) {
  const done = resultsIn(useStored(GAMES_KEY))[game][String(day)];
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [at, setAt] = useState(0);
  const question = questions[at];
  const shown = answered[at];

  const choose = async (choice: string) => {
    setBusy(true);
    setFailed(false);
    try {
      const checked = await checkAnswer(game, day, at, choice);
      setAnswered([...answered, { choice, ...checked }]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const finish = () => {
    const misses = answered.filter((a) => !a.correct).length;
    const answers = answered.map((a) => a.choice);
    writeStored(GAMES_KEY, withResult(readStored(GAMES_KEY), game, day, { score: misses, gaveUp: false, submitted: false, answers }));
  };

  if (done)
    return (
      <section className="dx-panel dx-quiz" aria-label={GAME_INFO[game].name}>
        <p className="dx-lead" role="status">
          You got {scoreText(game, done.score)} right.
        </p>
        <ShareButton
          label="Copy my result"
          text={`Song Nexus ${GAME_INFO[game].name}, ${longDate(day)}: ${scoreText(game, done.score)}.`}
        />
      </section>
    );
  return (
    <section className="dx-panel dx-quiz" aria-label={GAME_INFO[game].name}>
      <p className="dx-story-count">
        Question {at + 1} of {questions.length}
      </p>
      <h2 className="dx-quiz-question">{question.text}</h2>
      {question.song && <SongLink song={question.song} />}
      <ul className="dx-options" aria-label="Choices">
        {question.options.map((option) => {
          const state = !shown ? undefined : option.id === shown.answer.id ? "right" : option.id === shown.choice ? "wrong" : undefined;
          return (
            <li key={option.id}>
              <button
                type="button"
                className="dx-option"
                data-state={state}
                disabled={busy || !!shown}
                aria-pressed={shown?.choice === option.id}
                onClick={() => void choose(option.id)}
              >
                <Avatar id={option.id} name={option.name} photo={option.photo} size={56} />
                <span>{option.name}</span>
                {state === "right" && <Check size={18} aria-label="The answer" />}
                {state === "wrong" && <X size={18} aria-label="Not this one" />}
              </button>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p className="dx-hint" role="alert">
          That didn’t go through. Pick again.
        </p>
      )}
      {shown && (
        <div className="dx-quiz-proof" role="status">
          <p className="dx-lead">{shown.correct ? "Right." : `It’s ${shown.answer.name}.`}</p>
          <Reasons reasons={shown.proof} total={shown.proof.length} />
          {at < questions.length - 1 ? (
            <button type="button" className="dx-button" onClick={() => setAt(at + 1)}>
              Next question
            </button>
          ) : (
            <button type="button" className="dx-button" onClick={finish}>
              See my score
            </button>
          )}
        </div>
      )}
    </section>
  );
}
