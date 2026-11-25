import { NextResponse } from "next/server";
import { isRoomCode, joinRoom, normalizeCode, readRoom, roomStore } from "@/lib/rooms";
import { parseMember } from "@/lib/taste";

type Context = { params: Promise<{ code: string }> };
const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const NOT_FOUND = { error: "That code doesn’t match a room. It may have expired after a week, or have a typo." };

// GET /api/rooms/ABC234 → { room: { host, guest } }. The code is the key: anyone holding it can read both playlists.
export async function GET(_request: Request, { params }: Context) {
  const code = normalizeCode((await params).code);
  const store = roomStore();
  if (!store) return NextResponse.json({ error: "Short codes aren’t set up on this server.", unavailable: true }, { status: 503 });
  if (!isRoomCode(code)) return NextResponse.json(NOT_FOUND, { status: 404 });
  try {
    const room = await readRoom(store, code);
    return room ? NextResponse.json({ room }, NO_STORE) : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    console.error("[rooms] read failed:", error);
    return NextResponse.json({ error: "Couldn’t load this room just now.", retryable: true }, { status: 502 });
  }
}

// POST /api/rooms/ABC234 { name, songs } → { room } with the friend added. One friend per room.
export async function POST(request: Request, { params }: Context) {
  const code = normalizeCode((await params).code);
  const store = roomStore();
  if (!store) return NextResponse.json({ error: "Short codes aren’t set up on this server.", unavailable: true }, { status: 503 });
  if (!isRoomCode(code)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const member = parseMember(await request.json().catch(() => null));
  if (!member) return NextResponse.json({ error: "Send at least one song with both a title and an artist, up to 250." }, { status: 400 });
  try {
    const result = await joinRoom(store, code, member);
    if (result === "missing") return NextResponse.json(NOT_FOUND, { status: 404 });
    if (result === "full") return NextResponse.json({ error: "Someone has already joined this room. Ask for a new code." }, { status: 409 });
    return NextResponse.json({ room: result }, NO_STORE);
  } catch (error) {
    console.error("[rooms] join failed:", error);
    return NextResponse.json({ error: "Couldn’t join this room just now.", retryable: true }, { status: 502 });
  }
}
