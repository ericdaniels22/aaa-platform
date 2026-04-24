import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabaseClient();
  const guard = await requirePermission(supabase, "manage_vendors");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await request.json();
  const { name, vendor_type, default_category_id, is_1099, tax_id, notes } = body as Record<string, unknown>;

  const allowedTypes = ["supplier", "subcontractor", "equipment_rental", "fuel", "other"];
  if (vendor_type !== undefined && (typeof vendor_type !== "string" || !allowedTypes.includes(vendor_type))) {
    return NextResponse.json({ error: "invalid vendor_type" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof name === "string") updates.name = name.trim();
  if (typeof vendor_type === "string") updates.vendor_type = vendor_type;
  if (default_category_id !== undefined) updates.default_category_id = default_category_id ?? null;
  if (is_1099 !== undefined) updates.is_1099 = Boolean(is_1099);
  if (tax_id !== undefined) updates.tax_id = tax_id ?? null;
  if (notes !== undefined) updates.notes = notes ?? null;

  const service = createServiceClient();
  const { data, error } = await service
    .from("vendors")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", await getActiveOrganizationId(supabase))
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
