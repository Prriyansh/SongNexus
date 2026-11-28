import { connection } from "next/server";
import { graph } from "@/discover/lib/server";
import { stories, storyOfDay } from "@/discover/lib/stories";

const DAY_MS = 86_400_000;

/** Days since 1 January 1970, in UTC: one number per day, the same everywhere. */
export const dayNumber = (now: number) => Math.floor(now / DAY_MS);

// Today's pick, the same for everyone until midnight UTC.
export async function GET() {
  await connection();
  const now = Date.now();
  const day = dayNumber(now);
  const all = stories(graph());
  const n = all.length ? storyOfDay(all, day) : -1;
  const story = n < 0 ? null : { n: n + 1, title: all[n].title, text: all[n].text, artists: all[n].artists };
  const untilMidnight = Math.ceil(((day + 1) * DAY_MS - now) / 1000);
  return Response.json(
    { day, story },
    { headers: { "Cache-Control": `public, max-age=${Math.min(untilMidnight, 3600)}` } },
  );
}
