import { NextResponse } from "next/server";
import { redact } from "@/lib/accounts/crypto";
import { ApiProblem, appOrigin, readCookie, sessionCookieName } from "@/lib/accounts/http";
import { sessionUser } from "@/lib/accounts/users";
import { getDb } from "@/lib/db";
import { syncSoon } from "@/lib/integrations/background";
import { completeAuthorization } from "@/lib/integrations/connections";
import { isProviderId } from "@/lib/integrations/types";

export const maxDuration = 60;

// GET /api/integrations/:provider/callback?code=…&state=… — where a provider sends the user back.
// It always ends in a redirect to Connected Accounts, with ?connected= or ?error= for the page to show.
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = (query: Record<string, string>) => {
    const target = new URL("/accounts", appOrigin(request));
    for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
    // no-referrer: the address being left holds the one-time code.
    return NextResponse.redirect(target, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  };
  try {
    if (!isProviderId(provider)) throw new ApiProblem("Unknown music service.", 404);
    const db = await getDb();
    const user = await sessionUser(db, readCookie(request, sessionCookieName()));
    if (!user) throw new ApiProblem("Sign in to Song Nexus, then connect the account again.", 401);
    await completeAuthorization(db, user.id, provider, new URL(request.url).searchParams);
    syncSoon(db, user.id);
    return back({ connected: provider });
  } catch (error) {
    if (!(error instanceof ApiProblem)) console.error("[integrations] callback failed:", redact(error instanceof Error ? error.message : String(error)));
    return back({ error: error instanceof ApiProblem ? error.message : "The account couldn’t be connected. Please try again.", provider });
  }
}
