import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

async function requireManageVendors() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "admin") return { ok: true as const };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "manage_vendors").maybeSingle();
  if (perm?.granted) return { ok: true as const };
  return { ok: false as const, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireManageVendors();
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
  const { data, error } = await service.from("vendors").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
