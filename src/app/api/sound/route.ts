import { NextResponse } from "next/server";
import { compareSound } from "@/lib/sound";

const field = (params: URLSearchParams, name: string) => (params.get(name) ?? "").trim();

// GET /api/sound?aTitle=&aArtist=&bTitle=&bArtist=
// Sound and lyric comparison of two songs from the song_compare service. Always answers 200
// with a status ("ok" | "not-found" | "same-track" | "unavailable") unless the input is invalid,
// so the song comparison can show what's missing without treating it as an error.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const a = { title: field(params, "aTitle"), artist: field(params, "aArtist") };
  const b = { title: field(params, "bTitle"), artist: field(params, "bArtist") };
  if ([a.title, b.title].some((t) => !t) || [a.title, a.artist, b.title, b.artist].some((v) => v.length > 200)) {
    return NextResponse.json(
      { error: 'Query params "aTitle" and "bTitle" are required (artists optional), up to 200 characters each.' },
      { status: 400 }
    );
  }

  try {
    const result = await compareSound(a, b);
    if (result.status === "unavailable") {
      const hint = process.env.NODE_ENV === "development"
        ? "Start it with: cd song_compare && python backend/app.py"
        : undefined;
      return NextResponse.json({ ...result, hint }, { headers: { "Cache-Control": "no-store" } });
    }
    // The dataset is a fixed snapshot, so results can be cached for a while.
    return NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (error) {
    console.error("[sound] unexpected failure:", error);
    return NextResponse.json({ error: "Something went wrong while comparing the songs' sound." }, { status: 500 });
  }
}
