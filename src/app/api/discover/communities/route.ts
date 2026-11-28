import { authConfig, personOf } from "@/discover/lib/auth";
import { communityOf, join, leave, MAX_SHARED, memberships, viewOf } from "@/discover/lib/communities";
import { dayNumber } from "@/discover/lib/days";
import { graph } from "@/discover/lib/server";
import { store } from "@/discover/lib/store";
import { ready, refuse, reply } from "../account/shared";
import { bodyOf } from "../games/request";

// A community's chart, open to anyone: ?id=campus:wisc.edu or ?id=country:US. Without an ID, the
// communities the signed-in person belongs to, and the campus their account could join.
export async function GET(request: Request) {
  const kept = store();
  if (!kept) return refuse(503, "Around You isn’t set up on this server.");
  const person = authConfig() ? personOf(request) : null;
  const day = dayNumber(Date.now());
  const id = new URL(request.url).searchParams.get("id");
  if (id === null) {
    const joined = person ? await memberships(kept, person.sub) : [];
    const views = await Promise.all(joined.map((c) => viewOf(graph(), kept, communityOf(c)!, day, person!.sub)));
    return reply({ joined: views, campus: person?.domain ? `campus:${person.domain}` : null, signedIn: person !== null });
  }
  const community = communityOf(id);
  if (!community) return refuse(400, "That isn’t a campus or a country.");
  return reply(await viewOf(graph(), kept, community, day, person?.sub ?? null));
}

// Joins a community, or renews membership, sharing up to 25 artists: { id, artists }.
export async function POST(request: Request) {
  const found = ready(request, true);
  if (found instanceof Response) return found;
  if (!found.person) return refuse(401, "Sign in first.");
  const body = await bodyOf(request);
  const community = typeof body?.id === "string" ? communityOf(body.id) : null;
  if (!community) return refuse(400, "That isn’t a campus or a country.");
  if (community.kind === "campus" && found.person.domain !== community.name)
    return refuse(403, `Only people signed in with a ${community.name} account can join.`);
  const c = graph().catalog;
  const artists = (Array.isArray(body!.artists) ? body!.artists : [])
    .filter((a): a is string => typeof a === "string" && c.artistAt.has(a))
    .slice(0, MAX_SHARED);
  await join(found.store, community.id, found.person.sub, artists);
  return reply(await viewOf(graph(), found.store, community, dayNumber(Date.now()), found.person.sub));
}

// Leaves a community: ?id=…
export async function DELETE(request: Request) {
  const found = ready(request, true);
  if (found instanceof Response) return found;
  if (!found.person) return refuse(401, "Sign in first.");
  const community = communityOf(new URL(request.url).searchParams.get("id") ?? "");
  if (!community) return refuse(400, "That isn’t a campus or a country.");
  await leave(found.store, community.id, found.person.sub);
  return reply({ left: community.id });
}
