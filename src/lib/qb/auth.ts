// Shared gate used by every /api/qb/* route (except the cron endpoint,
// which authenticates via CRON_SECRET). Returns the authorized user id or
// an error response ready to be returned straight from the route handler.
//
// Admin-role check reads user_organizations.role scoped to the active org,
// resolved from the session JWT via getActiveOrganizationId.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

export type RequireAdminResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function requireAdmin(
  supabase: SupabaseClient,
): Promise<RequireAdminResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "not authenticated" }, { status: 401 }),
    };
  }
  const orgId = await getActiveOrganizationId(supabase);
  const { data: membership } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle<{ role: string }>();
  if (membership?.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "admin only" }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}
