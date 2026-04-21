import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// GET — list, any authenticated user. Bucket-D semantics: NULL-org rows are
// Nookleus-provided defaults visible to every tenant; org-scoped rows are
// visible only to members of that org.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const orgId = getActiveOrganizationId();
  const service = createServiceClient();
  const { data, error } = await service
    .from("expense_categories")
    .select("*")
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST — create custom category (always org-owned).
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const guard = await requirePermission(supabase, "manage_expense_categories");
  if (!guard.ok) return guard.response;

  const body = await request.json();
  const { name, display_label, bg_color, text_color, icon } = body as {
    name?: string; display_label?: string; bg_color?: string; text_color?: string; icon?: string;
  };
  if (!name || !display_label) {
    return NextResponse.json({ error: "name and display_label are required" }, { status: 400 });
  }

  const orgId = getActiveOrganizationId();
  const service = createServiceClient();
  const { data: existing } = await service
    .from("expense_categories")
    .select("sort_order")
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1;

  const { data, error } = await service.from("expense_categories").insert({
    organization_id: orgId,
    name: name.toLowerCase().replace(/\s+/g, "_"),
    display_label,
    bg_color: bg_color || "#F1EFE8",
    text_color: text_color || "#5F5E5A",
    icon: icon || null,
    sort_order: nextOrder,
    is_default: false,
  }).select().single();

  if (error) {
    if (error.message.includes("duplicate")) {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

// PUT — bulk update (rename/recolor/reorder). Scoped to the active org so
// a tenant can't mutate another org's rows; Nookleus-default rows (NULL
// org) are immutable from this endpoint.
export async function PUT(request: Request) {
  const supabase = await createServerSupabaseClient();
  const guard = await requirePermission(supabase, "manage_expense_categories");
  if (!guard.ok) return guard.response;

  const body = await request.json();
  const service = createServiceClient();
  const orgId = getActiveOrganizationId();

  const items = Array.isArray(body) ? body : [body];
  for (const item of items) {
    const { error } = await service.from("expense_categories").update({
      display_label: item.display_label,
      bg_color: item.bg_color,
      text_color: item.text_color,
      icon: item.icon,
      sort_order: item.sort_order,
    }).eq("id", item.id).eq("organization_id", orgId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE — custom categories only (not defaults), and not if any expense references it.
export async function DELETE(request: Request) {
  const supabase = await createServerSupabaseClient();
  const guard = await requirePermission(supabase, "manage_expense_categories");
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const service = createServiceClient();
  const orgId = getActiveOrganizationId();
  const { data: cat } = await service
    .from("expense_categories")
    .select("is_default, organization_id")
    .eq("id", id)
    .single();
  if (cat?.is_default || cat?.organization_id === null) {
    return NextResponse.json({ error: "Default categories cannot be deleted" }, { status: 403 });
  }

  const { count } = await service
    .from("expenses")
    .select("*", { count: "exact", head: true })
    .eq("category_id", id)
    .eq("organization_id", orgId);
  if (count && count > 0) {
    return NextResponse.json({ error: `Cannot delete — ${count} expense(s) use this category` }, { status: 409 });
  }

  const { error } = await service
    .from("expense_categories")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
