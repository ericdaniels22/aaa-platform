import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

async function requireAnyAuth() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  return { ok: true as const, user };
}

// GET — any authenticated user (used by Log Expense modal autocomplete too)
export async function GET(request: Request) {
  const auth = await requireAnyAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const active = searchParams.get("active");
  const type = searchParams.get("type");
  const is1099 = searchParams.get("is_1099");

  const service = createServiceClient();
  let query = service.from("vendors")
    .select("*, default_category:expense_categories!default_category_id(id, display_label, bg_color, text_color)")
    .eq("organization_id", getActiveOrganizationId())
    .order("name", { ascending: true });

  if (q) query = query.ilike("name", `%${q}%`);
  if (active === "true") query = query.eq("is_active", true);
  if (active === "false") query = query.eq("is_active", false);
  if (type) query = query.eq("vendor_type", type);
  if (is1099 === "true") query = query.eq("is_1099", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST — create. Quick-add (vendor_type=other, minimal fields) allows users
// with log_expenses permission; full creates require manage_vendors.
export async function POST(request: Request) {
  const body = await request.json();
  const { name, vendor_type, default_category_id, is_1099, tax_id, notes } = body as Record<string, unknown>;

  const quickAdd =
    vendor_type === "other" &&
    (default_category_id == null) &&
    !is_1099 &&
    (tax_id == null || tax_id === "") &&
    (notes == null || notes === "");

  const supabase = await createServerSupabaseClient();
  const neededKey = quickAdd ? "log_expenses" : "manage_vendors";
  const guard = await requirePermission(supabase, neededKey);
  if (!guard.ok) return guard.response;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const allowedTypes = ["supplier", "subcontractor", "equipment_rental", "fuel", "other"];
  if (typeof vendor_type !== "string" || !allowedTypes.includes(vendor_type)) {
    return NextResponse.json({ error: "invalid vendor_type" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service.from("vendors").insert({
    organization_id: getActiveOrganizationId(),
    name: name.trim(),
    vendor_type,
    default_category_id: (default_category_id as string | null | undefined) ?? null,
    is_1099: Boolean(is_1099),
    tax_id: (tax_id as string | null | undefined) ?? null,
    notes: (notes as string | null | undefined) ?? null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
