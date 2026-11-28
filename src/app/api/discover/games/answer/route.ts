import { checkAnswer } from "@/discover/lib/games";
import { LIMITS, tooMany } from "@/discover/lib/limits";
import { graph } from "@/discover/lib/server";
import { bodyOf, dayOf, NO_STORE, refuse } from "../request";

// Checks one quiz answer: {game: "credits" | "link", day, question, choice} with an artist ID.
export async function POST(request: Request) {
  const busy = await tooMany(request, LIMITS.play);
  if (busy) return busy;
  const body = await bodyOf(request);
  const day = dayOf(body?.day);
  const game = body?.game;
  if (day === null || (game !== "credits" && game !== "link")) return refuse(400, "That isn’t a quiz on a day with games.");
  const checked =
    Number.isInteger(body!.question) && typeof body!.choice === "string"
      ? checkAnswer(graph(), game, day, body!.question as number, body!.choice)
      : null;
  if (!checked) return refuse(400, "That isn’t one of the day’s questions.");
  return Response.json(checked, NO_STORE);
}
