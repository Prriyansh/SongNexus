import { json, route } from "@/lib/accounts/http";
import { commitImport } from "@/lib/integrations/imports";

// POST /api/imports/:id/commit → { import }: the staged rows become part of the library.
export const POST = route<{ id: string }>(async ({ db, user, params }) => json({ import: await commitImport(db, user.id, params.id) }));
