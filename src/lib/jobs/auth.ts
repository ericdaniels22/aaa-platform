// Authorization for the soft-delete / restore / force-delete job flows.
// Per product decision in #33: deleting a job (in any form) is restricted
// to admins and office_staff — crew members do not see the affordance and
// cannot reach the API. This is a hard role check, not a permission grant
// that can be issued to other roles.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

const ALLOWED_ROLES = new Set(["admin", "office_staff"]);

export type RequireJobsDeleteResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; response: NextResponse };

export async function requireJobsDelete(
  supabase: SupabaseClient,
): Promise<RequireJobsDeleteResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  if (!membership || !ALLOWED_ROLES.has(membership.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id, role: membership.role };
}

// Client-side mirror — the same role list, used to gate UI affordances.
export function canDeleteJobs(role: string | undefined | null): boolean {
  return !!role && ALLOWED_ROLES.has(role);
}
