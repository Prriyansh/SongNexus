import { isGame, isPlayer } from "@/discover/lib/game-info";
import { readBoard } from "@/discover/lib/leaderboard";
import { store } from "@/discover/lib/store";
import { dayOf, NO_STORE, refuse } from "../request";

// A day's leaderboard for one game: ?game=connect&day=20785&player=<id, to find your place>.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const day = dayOf(params.get("day"));
  const game = params.get("game") ?? "";
  if (day === null || !isGame(game)) return refuse(400, "That isn’t a game on a day with games.");
  const kept = store();
  if (!kept) return refuse(503, "Leaderboards aren’t set up on this server.");
  const player = params.get("player");
  return Response.json(await readBoard(kept, game, day, isPlayer(player) ? player : null), NO_STORE);
}
