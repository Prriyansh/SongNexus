import { json, route } from "@/lib/accounts/http";
import { deleteImport } from "@/lib/integrations/imports";

// DELETE /api/imports/:id → cancels a preview or rolls back a finished import.
export const DELETE = route<{ id: string }>(async ({ db, user, params }) => {
  await deleteImport(db, user.id, params.id);
  return json({ ok: true });
});
