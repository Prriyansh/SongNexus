import { syncedIn } from "@/discover/lib/account-data";
import { MAX_SYNCED, saveSynced } from "@/discover/lib/accounts";
import { ready, refuse, reply } from "../shared";

// Saves the signed-in person's synced data (games, hidden artists, Top 5, services), checked first.
export async function PUT(request: Request) {
  const found = ready(request, true);
  if (found instanceof Response) return found;
  if (!found.person) return refuse(401, "Sign in first.");
  const text = await request.text();
  if (text.length > MAX_SYNCED) return refuse(413, "That’s more than an account keeps.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "That isn’t data Song Nexus keeps.");
  }
  return reply({ synced: await saveSynced(found.store, found.person, syncedIn(body)) });
}
