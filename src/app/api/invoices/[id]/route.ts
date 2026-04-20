// GET /api/invoices/[id]     — detail with joined line items.
// PATCH /api/invoices/[id]   — edit. Status-gated: draft allows everything;
//                              sent/partial/paid require confirmLineItemEdit:true
//                              to change line_items/totals/dates.
//                              voided is read-only.
// DELETE /api/invoices/[id]  — draft only; hard delete.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  computeTotals,
  type InvoiceLineItemInput,
  type InvoiceRow,
  type InvoiceWithItems,
} from "@/lib/invoices/types";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle<InvoiceRow>();
  if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: items } = await supabase
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", id)
    .order("sort_order", { ascending: true });

  const result: InvoiceWithItems = {
    ...invoice,
    line_items: items ?? [],
  };
  return NextResponse.json(result);
}

interface PatchBody {
  issuedDate?: string;
  dueDate?: string | null;
  lineItems?: InvoiceLineItemInput[];
  taxRate?: number;
  poNumber?: string | null;
  memo?: string | null;
  notes?: string | null;
  confirmLineItemEdit?: boolean;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const service = createServiceClient();
  const { data: current } = await service
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle<InvoiceRow>();
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (current.status === "voided") {
    return NextResponse.json({ error: "voided invoices are read-only" }, { status: 400 });
  }

  const wantsGatedChange =
    body.issuedDate !== undefined
    || body.dueDate !== undefined
    || body.taxRate !== undefined
    || body.lineItems !== undefined;

  if (current.status !== "draft" && wantsGatedChange && !body.confirmLineItemEdit) {
    return NextResponse.json(
      { error: "confirmLineItemEdit required to change gated fields on a sent invoice" },
      { status: 409 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (body.poNumber !== undefined) patch.po_number = body.poNumber;
  if (body.memo !== undefined) patch.memo = body.memo;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.issuedDate !== undefined) patch.issued_date = body.issuedDate;
  if (body.dueDate !== undefined) patch.due_date = body.dueDate;

  // Recompute totals if line items or tax rate changed.
  let lineRowsToReplace: Array<{
    invoice_id: string;
    sort_order: number;
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
    xactimate_code: string | null;
  }> | null = null;

  if (body.lineItems || body.taxRate !== undefined) {
    const items = body.lineItems
      ? body.lineItems.map((li) => ({
          description: String(li.description ?? "").trim(),
          quantity: Number(li.quantity ?? 1),
          unit_price: Number(li.unit_price ?? 0),
          xactimate_code: li.xactimate_code?.toString().trim() || null,
        }))
      : null;

    if (items) {
      for (const li of items) {
        if (!li.description) {
          return NextResponse.json(
            { error: "line item description is required" },
            { status: 400 },
          );
        }
      }
    }

    const effectiveRate =
      body.taxRate !== undefined ? Number(body.taxRate) : Number(current.tax_rate);
    if (items) {
      const { subtotal, taxAmount, total, lineAmounts } = computeTotals(items, effectiveRate);
      patch.subtotal = subtotal;
      patch.tax_amount = taxAmount;
      patch.total_amount = total;
      patch.tax_rate = effectiveRate;
      lineRowsToReplace = items.map((li, idx) => ({
        invoice_id: id,
        sort_order: idx,
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
        amount: lineAmounts[idx],
        xactimate_code: li.xactimate_code,
      }));
    } else {
      // Only tax rate changed; recompute against existing line items.
      const { data: existing } = await service
        .from("invoice_line_items")
        .select("amount")
        .eq("invoice_id", id);
      const subtotal = (existing ?? []).reduce((a, b) => a + Number(b.amount), 0);
      const taxAmount = Math.round(subtotal * effectiveRate * 100) / 100;
      patch.subtotal = Math.round(subtotal * 100) / 100;
      patch.tax_amount = taxAmount;
      patch.total_amount = Math.round((subtotal + taxAmount) * 100) / 100;
      patch.tax_rate = effectiveRate;
    }
  }

  if (lineRowsToReplace) {
    const { error: delErr } = await service
      .from("invoice_line_items")
      .delete()
      .eq("invoice_id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    const { error: insErr } = await service
      .from("invoice_line_items")
      .insert(lineRowsToReplace);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  if (Object.keys(patch).length > 0) {
    const { data: updated, error: updErr } = await service
      .from("invoices")
      .update(patch)
      .eq("id", id)
      .select()
      .single<InvoiceRow>();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json(updated);
  }

  return NextResponse.json(current);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const service = createServiceClient();
  const { data: current } = await service
    .from("invoices")
    .select("status")
    .eq("id", id)
    .maybeSingle<{ status: string }>();
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (current.status !== "draft") {
    return NextResponse.json({ error: "only drafts can be deleted" }, { status: 400 });
  }

  const { error } = await service.from("invoices").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
