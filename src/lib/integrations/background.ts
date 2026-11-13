// Where sync work actually gets run. There are three triggers, because a serverless deployment
// has no process that stays alive:
//   - after a response (connect, "Sync now", opening the live stream): Next's after() keeps the
//     function alive to run the worker once the reply has been sent;
//   - a schedule: /api/integrations/cron, called by Vercel Cron or any scheduler;
//   - a loop inside the server process, started from src/instrumentation.ts, when there is a
//     long-lived process (next start, Docker, next dev).
// All three call the same worker, and the job queue makes it safe for them to overlap.

import { after } from "next/server";
import type { Db } from "../db";
import { databaseConfigured, getDb } from "../db";
import { housekeeping, kick } from "./sync";

type Env = Record<string, string | undefined>;

export const AFTER_BUDGET_MS = 45_000;
export const CRON_BUDGET_MS = 50_000;
const LOOP_INTERVAL_MS = 60_000;
const HOUSEKEEPING_EVERY = 60;

/** Runs the worker for one user once the current response has been sent. A no-op under test. */
export function syncSoon(db: Db, userId: string): void {
  if (process.env.NODE_ENV === "test") return;
  const run = () => kick(db, { budgetMs: AFTER_BUDGET_MS, userId });
  try { after(run); } catch { void run(); }
}

export type SchedulerInfo = { mode: "worker" | "scheduled"; note: string };

/** How this deployment keeps accounts fresh, in words the dashboard can show. */
export function schedulerInfo(env: Env = process.env): SchedulerInfo {
  if (env.VERCEL) {
    return { mode: "scheduled", note: "This deployment checks every account on a schedule (once a day unless its operator set it to run more often). In between, your accounts are checked whenever you have Song Nexus open, and “Sync now” checks straight away." };
  }
  return { mode: "worker", note: "A background worker looks for new data every minute and checks each kind of data as often as its service allows. “Sync now” checks straight away." };
}

const shared = globalThis as { __songNexusLoop?: ReturnType<typeof setInterval> };

/** The in-process loop for long-lived servers. Safe to call twice. */
export function startWorkerLoop(env: Env = process.env): boolean {
  if (shared.__songNexusLoop || env.VERCEL || env.SYNC_WORKER === "off" || !databaseConfigured(env)) return false;
  let ticks = 0;
  const tick = async () => {
    try {
      const db = await getDb(env);
      if (ticks++ % HOUSEKEEPING_EVERY === 0) await housekeeping(db);
      await kick(db, { budgetMs: LOOP_INTERVAL_MS - 5_000 });
    } catch (error) {
      console.error("[sync] worker loop:", error instanceof Error ? error.message : error);
    }
  };
  shared.__songNexusLoop = setInterval(() => void tick(), LOOP_INTERVAL_MS);
  // Don't hold the process open on shutdown.
  shared.__songNexusLoop.unref?.();
  // Shortly after start: picks up jobs that were queued or running when the last process stopped.
  setTimeout(() => void tick(), 5_000).unref?.();
  return true;
}
