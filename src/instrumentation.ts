// Runs once when a server process starts. On a long-lived server (next start, Docker, next dev)
// this starts the sync worker loop, which is also what resumes jobs after a restart. Serverless
// deployments skip it and rely on the cron route instead (see src/lib/integrations/background.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWorkerLoop } = await import("@/lib/integrations/background");
  startWorkerLoop();
}
