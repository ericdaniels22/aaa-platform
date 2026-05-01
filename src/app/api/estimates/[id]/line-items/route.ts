import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { recalculateTotals } from "@/lib/estimates";
import { round2 } from "@/lib/format";
import type { EstimateLineItem } from "@/lib/types";

interface RouteCtx { params: Promise<{ id: string }> }

interface CreatePayload {
  section_id: string;
  library_item_id?: string | null;
  description?: string;
  code?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price?: number;
  sort_order?: number;
}

interface ReorderPayload {
  items: Array<{ id: string; section_id: string; sort_order: number }>;
}

export async function POST(request: Request, ctx: RouteCtx) {
  const { id: estimateId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  let body: CreatePayload;
  try {
    body = (await request.json()) as CreatePayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.section_id !== "string" || !body.section_id) {
    return NextResponse.json({ error: "section_id required" }, { status: 400 });
  }
  if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity)) {
    return NextResponse.json({ error: "quantity must be a number" }, { status: 400 });
  }

  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

  // Verify section belongs to this estimate
  const { data: section } = await supabase
    .from("estimate_sections")
    .select("id")
    .eq("id", body.section_id)
    .eq("estimate_id", estimateId)
    .maybeSingle<{ id: string }>();
  if (!section) {
    return NextResponse.json({ error: "section not found" }, { status: 404 });
  }

  // Resolve fields — library snapshot OR custom
  let description: string;
  let code: string | null;
  let unit: string | null;
  let unit_price: number;

  if (body.library_item_id) {
    const { data: lib } = await supabase
      .from("item_library")
      .select("description, code, default_unit, unit_price, is_active")
      .eq("id", body.library_item_id)
      .maybeSingle<{
        description: string;
        code: string | null;
        default_unit: string | null;
        unit_price: number;
        is_active: boolean;
      }>();
    if (!lib) {
      return NextResponse.json({ error: "library item not found" }, { status: 404 });
    }
    if (!lib.is_active) {
      return NextResponse.json({ error: "library item is inactive" }, { status: 400 });
    }
    description = lib.description;
    code = lib.code;
    unit = lib.default_unit;
    unit_price = body.unit_price ?? lib.unit_price; // allow override at add-time
  } else {
    if (typeof body.description !== "string" || !body.description.trim()) {
      return NextResponse.json({ error: "description required for custom items" }, { status: 400 });
    }
    if (typeof body.unit_price !== "number" || !Number.isFinite(body.unit_price)) {
      return NextResponse.json({ error: "unit_price required for custom items" }, { status: 400 });
    }
    description = body.description.trim();
    if (description.length > 2000) {
      return NextResponse.json({ error: "description too long (max 2000)" }, { status: 400 });
    }
    code = body.code ?? null;
    unit = body.unit ?? null;
    unit_price = body.unit_price;
  }

  // Compute sort_order if not supplied
  let sort_order = body.sort_order;
  if (sort_order === undefined) {
    const { data: max } = await supabase
      .from("estimate_line_items")
      .select("sort_order")
      .eq("section_id", body.section_id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>();
    sort_order = (max?.sort_order ?? -1) + 1;
  }

  const total = round2(body.quantity * unit_price);

  const { data, error } = await supabase
    .from("estimate_line_items")
    .insert({
      organization_id: orgId,
      estimate_id: estimateId,
      section_id: body.section_id,
      library_item_id: body.library_item_id ?? null,
      description,
      code,
      quantity: body.quantity,
      unit,
      unit_price,
      total,
      sort_order,
    })
    .select("*")
    .single<EstimateLineItem>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalculateTotals(estimateId, supabase);

  return NextResponse.json({ line_item: data }, { status: 201 });
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id: estimateId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  let body: ReorderPayload;
  try {
    body = (await request.json()) as ReorderPayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: "items array required" }, { status: 400 });
  }

  for (const it of body.items) {
    if (typeof it.id !== "string" || typeof it.section_id !== "string" ||
        typeof it.sort_order !== "number") {
      return NextResponse.json({ error: "invalid item shape" }, { status: 400 });
    }
    const { error } = await supabase
      .from("estimate_line_items")
      .update({ section_id: it.section_id, sort_order: it.sort_order })
      .eq("id", it.id)
      .eq("estimate_id", estimateId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sort-only reorder doesn't change quantity * unit_price totals, but
  // section moves COULD if the future per-section subtotal feature ships.
  // No recalc needed today; revisit if subtotals-by-section land.

  return NextResponse.json({ ok: true });
}
