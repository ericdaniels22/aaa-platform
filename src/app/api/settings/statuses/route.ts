import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// GET /api/settings/statuses — returns NULL-org defaults plus this org's customizations.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);
  const { data, error } = await supabase
    .from("job_statuses")
    .select("*")
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order("sort_order");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/settings/statuses — create new status (always org-owned).
export async function POST(request: Request) {
  const body = await request.json();
  const { name, display_label, bg_color, text_color } = body;

  if (!name || !display_label) {
    return NextResponse.json({ error: "name and display_label are required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);

  // Get max sort_order (across defaults + this org's rows).
  const { data: existing } = await supabase
    .from("job_statuses")
    .select("sort_order")
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("job_statuses")
    .insert({
      organization_id: orgId,
      name: name.toLowerCase().replace(/\s+/g, "_"),
      display_label,
      bg_color: bg_color || "#F1EFE8",
      text_color: text_color || "#5F5E5A",
      sort_order: nextOrder,
      is_default: false,
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes("duplicate")) {
      return NextResponse.json({ error: "A status with that name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

// PUT /api/settings/statuses — bulk update (for reordering + editing). Only
// touches the active org's rows; defaults (NULL-org) are immutable here.
export async function PUT(request: Request) {
  const body = await request.json();
  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);

  if (Array.isArray(body)) {
    for (const item of body) {
      const { error } = await supabase
        .from("job_statuses")
        .update({
          display_label: item.display_label,
          bg_color: item.bg_color,
          text_color: item.text_color,
          sort_order: item.sort_order,
        })
        .eq("id", item.id)
        .eq("organization_id", orgId);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  const { id, display_label, bg_color, text_color, sort_order } = body;
  const { error } = await supabase
    .from("job_statuses")
    .update({ display_label, bg_color, text_color, sort_order })
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/settings/statuses?id=xxx
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);

  // Read the target row to check default + get the name.
  const { data: status } = await supabase
    .from("job_statuses")
    .select("is_default, name, organization_id")
    .eq("id", id)
    .single();

  if (status?.is_default || status?.organization_id === null) {
    return NextResponse.json({ error: "Default statuses cannot be deleted" }, { status: 403 });
  }

  // Check if any jobs in this org use this status
  const { count } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", status?.name || "");

  if (count && count > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} job(s) use this status` },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from("job_statuses")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
