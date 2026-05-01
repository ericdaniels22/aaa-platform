import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getEstimateWithContents, recalculateTotals } from "@/lib/estimates";
import type { Estimate } from "@/lib/types";

interface RouteCtx { params: Promise<{ id: string }> }

interface UpdatePayload {
  title?: string;
  opening_statement?: string | null;
  closing_statement?: string | null;
  issued_date?: string | null;
  valid_until?: string | null;
  markup_type?: "percent" | "amount" | "none";
  markup_value?: number;
  discount_type?: "percent" | "amount" | "none";
  discount_value?: number;
  tax_rate?: number;
  status?: Estimate["status"];
  updated_at_snapshot?: string;
}

export async function GET(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "view_estimates");
  if (!auth.ok) return auth.response;

  const estimate = await getEstimateWithContents(id, supabase);
  if (!estimate) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ estimate });
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as UpdatePayload;

  // Concurrent-edit guard
  if (body.updated_at_snapshot) {
    const { data: current } = await supabase
      .from("estimates")
      .select("updated_at")
      .eq("id", id)
      .maybeSingle<{ updated_at: string }>();
    if (current && current.updated_at !== body.updated_at_snapshot) {
      const fresh = await getEstimateWithContents(id, supabase);
      return NextResponse.json({ error: "stale", estimate: fresh }, { status: 409 });
    }
  }

  const update: Record<string, unknown> = {};
  for (const k of ["title","opening_statement","closing_statement","issued_date","valid_until",
                    "markup_type","markup_value","discount_type","discount_value","tax_rate","status"] as const) {
    if (k in body && body[k] !== undefined) update[k] = body[k];
  }
  if (body.tax_rate !== undefined) {
    if (body.tax_rate < 0 || body.tax_rate > 100) {
      return NextResponse.json({ error: "tax_rate must be between 0 and 100" }, { status: 400 });
    }
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("estimates").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Always recalc — markup/discount/tax may have changed
  await recalculateTotals(id, supabase);

  const fresh = await getEstimateWithContents(id, supabase);
  return NextResponse.json({ estimate: fresh });
}

export async function DELETE(request: Request, ctx: RouteCtx) {
  // DELETE = void (no hard delete)
  const { id } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const reason = url.searchParams.get("reason");

  const { error } = await supabase
    .from("estimates")
    .update({
      status: "voided",
      voided_at: new Date().toISOString(),
      void_reason: reason,
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
