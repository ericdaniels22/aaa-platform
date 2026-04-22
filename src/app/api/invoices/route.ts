// GET /api/invoices — list with filters (jobId, status, search, limit, offset).
// POST /api/invoices — create a draft invoice with line items in one atomic shot.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  computeTotals,
  type CreateInvoiceInput,
  type InvoiceRow,
  type InvoiceLineItemInput,
} from "@/lib/invoices/types";

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search")?.trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  let query = supabase
    .from("invoices")
    .select(
      "*, jobs!inner(id, job_number, property_address, contact_id, contacts:contact_id(first_name, last_name))",
      { count: "exact" },
    )
    .eq("organization_id", getActiveOrganizationId())
    .order("issued_date", { ascending: false })
    .range(offset, offset + limit - 1);

  if (jobId) query = query.eq("job_id", jobId);
  if (status) query = query.eq("status", status);
  if (search) {
    query = query.or(
      `invoice_number.ilike.%${search}%,memo.ilike.%${search}%,notes.ilike.%${search}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [], total: count ?? 0 });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as CreateInvoiceInput | null;
  if (!body || typeof body.jobId !== "string") {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
    return NextResponse.json({ error: "at least one line item is required" }, { status: 400 });
  }

  const items: InvoiceLineItemInput[] = body.lineItems.map((li) => ({
    description: String(li.description ?? "").trim(),
    quantity: Number(li.quantity ?? 1),
    unit_price: Number(li.unit_price ?? 0),
    xactimate_code: li.xactimate_code?.toString().trim() || null,
  }));
  for (const li of items) {
    if (!li.description) {
      return NextResponse.json({ error: "line item description is required" }, { status: 400 });
    }
  }

  const taxRate = Number(body.taxRate ?? 0);
  const { subtotal, taxAmount, total, lineAmounts } = computeTotals(items, taxRate);

  const issued = body.issuedDate ?? new Date().toISOString();
  const due = body.dueDate === null ? null : (body.dueDate ?? addDays(issued, 30));

  const orgId = getActiveOrganizationId();
  const service = createServiceClient();
  const { data: inv, error: invErr } = await service
    .from("invoices")
    .insert({
      organization_id: orgId,
      job_id: body.jobId,
      status: "draft",
      issued_date: issued,
      due_date: due,
      subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total_amount: total,
      po_number: body.poNumber ?? null,
      memo: body.memo ?? null,
      notes: body.notes ?? null,
    })
    .select()
    .single<InvoiceRow>();
  if (invErr || !inv) {
    return NextResponse.json({ error: invErr?.message ?? "insert failed" }, { status: 500 });
  }

  const rows = items.map((li, idx) => ({
    organization_id: orgId,
    invoice_id: inv.id,
    sort_order: idx,
    description: li.description,
    quantity: li.quantity,
    unit_price: li.unit_price,
    amount: lineAmounts[idx],
    xactimate_code: li.xactimate_code,
  }));
  const { error: liErr } = await service.from("invoice_line_items").insert(rows);
  if (liErr) {
    // Rollback: delete the parent invoice.
    await service.from("invoices").delete().eq("id", inv.id);
    return NextResponse.json({ error: liErr.message }, { status: 500 });
  }

  return NextResponse.json(inv);
}
