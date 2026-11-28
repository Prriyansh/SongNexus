import { isGame, isPlayer } from "@/discover/lib/game-info";
import { scoreOf } from "@/discover/lib/games";
import { cleanName, submitScore } from "@/discover/lib/leaderboard";
import { graph } from "@/discover/lib/server";
import { store } from "@/discover/lib/store";
import { bodyOf, dayOf, NO_STORE, refuse } from "../request";

// Puts a finished game on the day's leaderboard: {game, day, player, name, answers}. The score is
// worked out here from the answers (a Connect chain, or a quiz's choices), never taken on trust.
export async function POST(request: Request) {
  const body = await bodyOf(request);
  const day = dayOf(body?.day);
  const game = typeof body?.game === "string" && isGame(body.game) ? body.game : null;
  if (day === null || !game || !isPlayer(body!.player)) return refuse(400, "That isn’t a game on a day with games.");
  const name = cleanName(body!.name);
  if (!name) return refuse(400, "Pick a name of 2 to 24 letters, numbers and spaces.");
  const answers = Array.isArray(body!.answers) && body!.answers.every((a) => typeof a === "string") ? (body!.answers as string[]) : [];
  const score = scoreOf(graph(), game, day, answers);
  if (score === null) return refuse(400, "Those answers don’t finish the game.");
  const kept = store();
  if (!kept) return refuse(503, "Leaderboards aren’t set up on this server.");
  const placed = await submitScore(kept, game, day, body!.player as string, name, score, Date.now());
  return Response.json({ score, ...placed }, NO_STORE);
}
