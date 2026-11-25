import { NextResponse } from "next/server";
import { createRoom, roomStore } from "@/lib/rooms";
import { parseMember } from "@/lib/taste";

const UNAVAILABLE = { error: "Short codes aren’t set up on this server.", unavailable: true };

// POST /api/rooms { name, songs: [{ title, artist }] } → { code }
export async function POST(request: Request) {
  const store = roomStore();
  if (!store) return NextResponse.json(UNAVAILABLE, { status: 503 });
  const member = parseMember(await request.json().catch(() => null));
  if (!member) return NextResponse.json({ error: "Send at least one song with both a title and an artist, up to 250." }, { status: 400 });
  try {
    return NextResponse.json({ code: await createRoom(store, member) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[rooms] create failed:", error);
    return NextResponse.json({ error: "Couldn’t create a code just now. Please try again.", retryable: true }, { status: 502 });
  }
}
