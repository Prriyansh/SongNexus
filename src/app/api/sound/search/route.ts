import { NextResponse } from "next/server";
import { searchSound } from "@/lib/sound";

// GET /api/sound/search?q=&limit=
// Songs in the sound dataset matching a title or artist. Answers { status: "unavailable" } when
// the song_compare service isn't running, so the picker can fall back to MusicBrainz search.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 200) {
    return NextResponse.json({ error: 'Query param "q" must be 2–200 characters.' }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "10", 10) || 10, 1), 25);
  const result = await searchSound(q, limit);
  return NextResponse.json(result, {
    headers: { "Cache-Control": result.status === "ok" ? "public, max-age=3600" : "no-store" },
  });
}
