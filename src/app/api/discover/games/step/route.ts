import { linkReason, puzzleOf } from "@/discover/lib/games";
import { LIMITS, tooMany } from "@/discover/lib/limits";
import { graph } from "@/discover/lib/server";
import { bodyOf, dayOf, NO_STORE, refuse } from "../request";

// One step of Connect: did these two artists work together? {day, from, guess} with artist IDs.
export async function POST(request: Request) {
  const busy = await tooMany(request, LIMITS.play);
  if (busy) return busy;
  const body = await bodyOf(request);
  const day = dayOf(body?.day);
  if (day === null) return refuse(400, "That isn’t a day with games.");
  const g = graph();
  const puzzle = puzzleOf(g, day);
  if (!puzzle) return refuse(404, "There’s no Connect puzzle that day.");
  const [from, guess] = [body!.from, body!.guess].map((id) =>
    typeof id === "string" ? g.catalog.artistAt.get(id) : undefined,
  );
  if (from === undefined || guess === undefined) return refuse(400, "Both artists must be in the catalog.");
  const reason = from === guess ? null : linkReason(g, from, guess);
  return Response.json({ linked: reason !== null, reason, reached: reason !== null && body!.guess === puzzle.target.id }, NO_STORE);
}
