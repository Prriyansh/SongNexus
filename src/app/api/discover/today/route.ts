import { connection } from "next/server";
import { DAY_MS, dayNumber } from "@/discover/lib/days";
import { graph } from "@/discover/lib/server";
import { stories, storyOfDay } from "@/discover/lib/stories";

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
