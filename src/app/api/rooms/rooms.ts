// What the two room routes share. Not a route itself (no route.ts).
import { fail } from "../respond";

export const BAD_PLAYLIST = "Send at least one song with both a title and an artist, up to 250.";

/** Without a store (no Redis in production) there are no short codes; the app falls back to links. */
export const unavailable = () =>
  fail(503, "Short codes aren’t set up on this server.", { unavailable: true });

export const notFound = () =>
  fail(404, "That code doesn’t match a room. It may have expired after a week, or have a typo.");
