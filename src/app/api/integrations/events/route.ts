import { problemResponse, readCookie, sessionCookieName } from "@/lib/accounts/http";
import { sessionUser } from "@/lib/accounts/users";
import { getDb } from "@/lib/db";
import { eventsAfter, latestSeq, onLocalEvent } from "@/lib/integrations/events";
import { kick } from "@/lib/integrations/sync";

export const maxDuration = 60;

/** Closed before the platform's limit; EventSource reconnects by itself and resumes from Last-Event-ID. */
const STREAM_MS = 50_000;
const POLL_MS = 2_000;
const HEARTBEAT_MS = 15_000;

// GET /api/integrations/events — Server-Sent Events for the signed-in user: sync progress, connection
// changes, new library rows, imports. This is how the page updates the moment Song Nexus stores
// something; how soon Song Nexus hears from a provider is a separate matter (see each provider's
// sync interval). While a stream is open, the user's due syncs are run from here too.
export async function GET(request: Request) {
  try {
    const db = await getDb();
    const user = await sessionUser(db, readCookie(request, sessionCookieName()));
    if (!user) return new Response(JSON.stringify({ error: "Sign in to Song Nexus first.", signedOut: true }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    const resume = Number(request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after"));
    let seq = Number.isFinite(resume) && resume > 0 ? resume : await latestSeq(db, user.id);
    const encoder = new TextEncoder();
    let stop = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false, busy = false;
        const send = (text: string) => { if (!closed) controller.enqueue(encoder.encode(text)); };
        const flush = async () => {
          if (busy || closed) return;
          busy = true;
          try {
            for (const event of await eventsAfter(db, user.id, seq)) {
              seq = event.seq;
              send(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
            }
          } catch { /* A failed poll is retried on the next tick. */ } finally { busy = false; }
        };
        const unsubscribe = onLocalEvent(user.id, () => void flush());
        const poll = setInterval(() => void flush(), POLL_MS);
        const heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);
        stop = () => {
          if (closed) return;
          closed = true;
          clearInterval(poll); clearInterval(heartbeat); clearTimeout(end); unsubscribe();
          try { controller.close(); } catch { /* Already closed by the client. */ }
        };
        const end = setTimeout(stop, STREAM_MS);
        request.signal.addEventListener("abort", stop);
        send(`retry: 1500\n: connected\n\n`);
        void flush();
        // Having the app open is the user's signal that freshness matters now.
        if (process.env.NODE_ENV !== "test") void kick(db, { budgetMs: STREAM_MS - 5_000, userId: user.id });
      },
      cancel() { stop(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error) {
    return problemResponse(error, "events");
  }
}
