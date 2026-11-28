import { LIMITS, tooMany } from "@/discover/lib/limits";
import { heardFrom, ListeningError, matchHeard } from "@/discover/lib/listening";
import { graph } from "@/discover/lib/server";
import { isService, isUser } from "@/discover/lib/services";

// What someone listens to most: ?service=listenbrainz|lastfm|deezer&user=<name>. Kept a while in
// the browser only: it's about one person.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const service = params.get("service") ?? "";
  const user = (params.get("user") ?? "").trim();
  if (!isService(service) || !isUser(service, user))
    return Response.json({ error: "That isn’t a username this service would have." }, { status: 400 });
  const busy = await tooMany(request, LIMITS.listening);
  if (busy) return busy;
  try {
    const heard = await heardFrom(service, user, process.env, fetch);
    return Response.json(
      { artists: matchHeard(graph().catalog, heard) },
      { headers: { "Cache-Control": "private, max-age=600" } },
    );
  } catch (error) {
    const { message, status } = error as ListeningError;
    return Response.json({ error: message }, { status });
  }
}
