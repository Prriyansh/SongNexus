import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/accounts/crypto";
import { NO_STORE, problemResponse } from "@/lib/accounts/http";
import { getDb } from "@/lib/db";
import { CRON_BUDGET_MS } from "@/lib/integrations/background";
import { housekeeping, runWorker } from "@/lib/integrations/sync";

export const maxDuration = 60;

// GET /api/integrations/cron — one pass of the sync worker over every account, for a scheduler to
// call. Vercel Cron sends "Authorization: Bearer $CRON_SECRET"; any other scheduler can do the same.
// Without CRON_SECRET set, the route refuses everyone.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(given, `Bearer ${secret}`)) return NextResponse.json({ error: "Not authorized." }, { status: 401, headers: NO_STORE });
  try {
    const db = await getDb();
    await housekeeping(db);
    return NextResponse.json(await runWorker(db, { budgetMs: CRON_BUDGET_MS }), { headers: NO_STORE });
  } catch (error) {
    return problemResponse(error, "cron");
  }
}
