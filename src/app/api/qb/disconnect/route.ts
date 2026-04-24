import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requireAdmin } from "@/lib/qb/auth";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// POST /api/qb/disconnect — mark all active connections inactive. We keep
// the encrypted tokens on the row for audit; a future reconnect creates a
// new row rather than reviving the old one.
export async function POST() {
  const supabase = await createServerSupabaseClient();
  const guard = await requireAdmin(supabase);
  if (!guard.ok) return guard.response;

  const service = createServiceClient();
  const { error } = await service
    .from("qb_connection")
    .update({ is_active: false })
    .eq("is_active", true)
    .eq("organization_id", await getActiveOrganizationId(supabase));
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
