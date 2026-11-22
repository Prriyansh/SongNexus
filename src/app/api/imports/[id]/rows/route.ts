import { json, readJson, route } from "@/lib/accounts/http";
import { addImportRows } from "@/lib/integrations/imports";

// POST /api/imports/:id/rows { rows: [...] } → { import } with running totals. Up to 2,500 rows a request.
export const POST = route<{ id: string }>(async ({ request, db, user, params }) => {
  const body = await readJson(request);
  return json({ import: await addImportRows(db, user.id, params.id, body.rows, body.batch) });
});
