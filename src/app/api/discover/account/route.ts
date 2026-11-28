import { authConfig, sessionCookie } from "@/discover/lib/auth";
import { deleteAccount, readAccount } from "@/discover/lib/accounts";
import { leaveAll } from "@/discover/lib/communities";
import { ready, refuse, reply } from "./shared";

// Who is signed in, and their synced data: { enabled, person, synced }.
export async function GET(request: Request) {
  if (!authConfig()) return reply({ enabled: false, person: null, synced: null });
  const found = ready(request, false);
  if (found instanceof Response) return found;
  if (!found.person) return reply({ enabled: true, person: null, synced: null });
  const account = await readAccount(found.store, found.person.sub);
  const { name, picture, domain } = found.person;
  return reply({ enabled: true, person: { name, picture, domain }, synced: account?.synced ?? null });
}

// Deletes the signed-in account, everything synced to it and its communities, and signs out.
export async function DELETE(request: Request) {
  const found = ready(request, true);
  if (found instanceof Response) return found;
  if (!found.person) return refuse(401, "Sign in first.");
  await leaveAll(found.store, found.person.sub);
  await deleteAccount(found.store, found.person.sub);
  return reply({ deleted: true }, 200, { "Set-Cookie": sessionCookie(null) });
}
