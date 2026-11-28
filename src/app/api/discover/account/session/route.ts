import { sessionCookie, sessionValue, verifyGoogle } from "@/discover/lib/auth";
import { signedIn } from "@/discover/lib/accounts";
import { bodyOf } from "../../games/request";
import { ready, refuse, reply } from "../shared";

// Signs in with the ID token Google's button gave the browser: { credential }.
export async function POST(request: Request) {
  const found = ready(request, true);
  if (found instanceof Response) return found;
  const credential = (await bodyOf(request))?.credential;
  if (typeof credential !== "string" || credential.length > 4096) return refuse(400, "That isn’t a sign-in from Google.");
  let person;
  try {
    person = await verifyGoogle(credential, found.clientId);
  } catch {
    return refuse(502, "Google couldn’t be reached to check the sign-in. Try again.");
  }
  if (!person) return refuse(401, "Google didn’t confirm that sign-in.");
  const account = await signedIn(found.store, person);
  return reply(
    { person: { name: person.name, picture: person.picture, domain: person.domain }, synced: account.synced },
    200,
    { "Set-Cookie": sessionCookie(sessionValue(person, found.secret)) },
  );
}

// Signs out.
export async function DELETE(request: Request) {
  const found = ready(request, true);
  if (found instanceof Response) return found;
  return reply({ signedOut: true }, 200, { "Set-Cookie": sessionCookie(null) });
}
