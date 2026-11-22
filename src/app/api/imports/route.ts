import { json, readJson, route } from "@/lib/accounts/http";
import { createImport, listImports } from "@/lib/integrations/imports";

// GET /api/imports → { imports } (finished ones).
export const GET = route(async ({ db, user }) => json({ imports: await listImports(db, user.id) }));

// POST /api/imports { format, filename, sha256 } → 201 { import }. 409 if this exact file was imported before.
export const POST = route(async ({ request, db, user }) => json({ import: await createImport(db, user.id, await readJson(request)) }, 201));
