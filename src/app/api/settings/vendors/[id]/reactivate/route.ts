import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabaseClient();
  const guard = await requirePermission(supabase, "manage_vendors");
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const service = createServiceClient();
  const { error } = await service
    .from("vendors")
    .update({ is_active: true })
    .eq("id", id)
    .eq("organization_id", getActiveOrganizationId());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
