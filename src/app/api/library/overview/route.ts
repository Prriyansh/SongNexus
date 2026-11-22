import { json, route } from "@/lib/accounts/http";
import { consents } from "@/lib/accounts/users";
import { listImports } from "@/lib/integrations/imports";
import { coverage, nowPlaying } from "@/lib/integrations/library";

// GET /api/library/overview → { coverage, nowPlaying, imports, consents }: what each source holds,
// how far back its plays go and when it was last refreshed.
export const GET = route(async ({ db, user }) => json({
  coverage: await coverage(db, user.id), nowPlaying: await nowPlaying(db, user.id), imports: await listImports(db, user.id), consents: await consents(db, user.id),
}));
