import { isRoomCode, joinRoom, normalizeCode, readRoom, roomStore } from "@/lib/rooms";
import { parseMember } from "@/lib/taste";
import { bodyOf, CACHE, fail, ok } from "../../respond";
import { BAD_PLAYLIST, notFound, unavailable } from "../rooms";

type Context = { params: Promise<{ code: string }> };

// GET /api/rooms/ABC234 → { room: { host, guest } }. The code is the key: anyone holding it can
// read both playlists. Codes are read loosely ("abc-234" works).
export async function GET(_request: Request, { params }: Context) {
  const code = normalizeCode((await params).code);
  const store = roomStore();
  if (!store) return unavailable();
  if (!isRoomCode(code)) return notFound();
  try {
    const room = await readRoom(store, code);
    return room ? ok({ room }, CACHE.never) : notFound();
  } catch (error) {
    console.error("[rooms] read failed:", error);
    return fail(502, "Couldn’t load this room just now.", { retryable: true });
  }
}

// POST /api/rooms/ABC234 { name, songs } → { room } with the friend added. One friend per room.
export async function POST(request: Request, { params }: Context) {
  const code = normalizeCode((await params).code);
  const store = roomStore();
  if (!store) return unavailable();
  if (!isRoomCode(code)) return notFound();
  const member = parseMember(await bodyOf(request));
  if (!member) return fail(400, BAD_PLAYLIST);
  try {
    const result = await joinRoom(store, code, member);
    if (result === "missing") return notFound();
    if (result === "full")
      return fail(409, "Someone has already joined this room. Ask for a new code.");
    return ok({ room: result }, CACHE.never);
  } catch (error) {
    console.error("[rooms] join failed:", error);
    return fail(502, "Couldn’t join this room just now.", { retryable: true });
  }
}
