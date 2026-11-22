import { NextResponse } from "next/server";
import { NO_STORE } from "@/lib/accounts/http";
import { databaseConfigured } from "@/lib/db";
import { schedulerInfo } from "@/lib/integrations/background";
import { IMPORT_FORMATS } from "@/lib/integrations/import-formats";
import { FEATURE_RULES } from "@/lib/integrations/policy";
import { describeAll } from "@/lib/integrations/registry";

// GET /api/integrations/providers → every service, whether it can be connected here and what it
// can do, the rules for using its data, and how this deployment keeps accounts fresh. Public.
export async function GET(request: Request) {
  // Reading the request keeps this dynamic: availability depends on this server's environment.
  void request.headers;
  return NextResponse.json({ accounts: databaseConfigured(), providers: describeAll(), rules: FEATURE_RULES, formats: IMPORT_FORMATS, scheduler: schedulerInfo() }, { headers: NO_STORE });
}
