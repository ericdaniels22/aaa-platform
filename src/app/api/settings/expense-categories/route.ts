import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

async function requireManageCategories(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "admin") return { ok: true };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted")
    .eq("user_id", user.id)
    .eq("permission_key", "manage_expense_categories")
    .maybeSingle();
  if (perm?.granted) return { ok: true };
  return { ok: false, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

// GET — list, any authenticated user
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service.from("expense_categories").select("*").order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST — create custom category
export async function POST(request: Request) {
  const guard = await requireManageCategories();
  if (!guard.ok) return guard.response;

  const body = await request.json();
  const { name, display_label, bg_color, text_color, icon } = body as {
    name?: string; display_label?: string; bg_color?: string; text_color?: string; icon?: string;
  };
  if (!name || !display_label) {
    return NextResponse.json({ error: "name and display_label are required" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: existing } = await service.from("expense_categories")
    .select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1;

  const { data, error } = await service.from("expense_categories").insert({
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

// PUT — bulk update (rename/recolor/reorder)
export async function PUT(request: Request) {
  const guard = await requireManageCategories();
  if (!guard.ok) return guard.response;

  const body = await request.json();
  const service = createServiceClient();

  const items = Array.isArray(body) ? body : [body];
  for (const item of items) {
    const { error } = await service.from("expense_categories").update({
      display_label: item.display_label,
      bg_color: item.bg_color,
      text_color: item.text_color,
      icon: item.icon,
      sort_order: item.sort_order,
    }).eq("id", item.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE — custom categories only, and not if any expense references it
export async function DELETE(request: Request) {
  const guard = await requireManageCategories();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const service = createServiceClient();
  const { data: cat } = await service.from("expense_categories").select("is_default").eq("id", id).single();
  if (cat?.is_default) {
    return NextResponse.json({ error: "Default categories cannot be deleted" }, { status: 403 });
  }

  const { count } = await service.from("expenses").select("*", { count: "exact", head: true }).eq("category_id", id);
  if (count && count > 0) {
    return NextResponse.json({ error: `Cannot delete — ${count} expense(s) use this category` }, { status: 409 });
  }

  const { error } = await service.from("expense_categories").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
