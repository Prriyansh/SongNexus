import { createRoom, roomStore } from "@/lib/rooms";
import { parseMember } from "@/lib/taste";
import { bodyOf, CACHE, fail, ok } from "../respond";
import { BAD_PLAYLIST, unavailable } from "./rooms";

// POST /api/rooms { name, songs: [{ title, artist }] } → { code }
export async function POST(request: Request) {
  const store = roomStore();
  if (!store) return unavailable();
  const member = parseMember(await bodyOf(request));
  if (!member) return fail(400, BAD_PLAYLIST);
  try {
    return ok({ code: await createRoom(store, member) }, CACHE.never);
  } catch (error) {
    console.error("[rooms] create failed:", error);
    return fail(502, "Couldn’t create a code just now. Please try again.", { retryable: true });
  }
}
