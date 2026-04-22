// GET  /api/payments?invoiceId=&jobId=   — list.
// POST /api/payments                       — record a payment.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

interface CreatePaymentBody {
  jobId: string;
  invoiceId?: string | null;
  source: "insurance" | "homeowner" | "other";
  method: "check" | "ach" | "venmo_zelle" | "cash" | "credit_card";
  amount: number;
  referenceNumber?: string | null;
  payerName?: string | null;
  receivedDate?: string | null;
  notes?: string | null;
}

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const invoiceId = url.searchParams.get("invoiceId");
  const jobId = url.searchParams.get("jobId");

  let query = supabase
    .from("payments")
    .select("*")
    .eq("organization_id", getActiveOrganizationId())
    .order("received_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (invoiceId) query = query.eq("invoice_id", invoiceId);
  if (jobId) query = query.eq("job_id", jobId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as CreatePaymentBody | null;
  if (!body?.jobId || !body?.source || !body?.method || !body.amount) {
    return NextResponse.json({ error: "jobId, source, method, amount required" }, { status: 400 });
  }

  const orgId = getActiveOrganizationId();
  const service = createServiceClient();
  if (body.invoiceId) {
    const { data: inv } = await service
      .from("invoices")
      .select("status")
      .eq("id", body.invoiceId)
      .eq("organization_id", orgId)
      .maybeSingle<{ status: string }>();
    if (inv?.status === "draft") {
      return NextResponse.json(
        { error: "Cannot record a payment on a draft invoice. Send or mark it sent first." },
        { status: 400 },
      );
    }
  }

  const { data, error } = await service
    .from("payments")
    .insert({
      organization_id: orgId,
      job_id: body.jobId,
      invoice_id: body.invoiceId ?? null,
      source: body.source,
      method: body.method,
      amount: body.amount,
      reference_number: body.referenceNumber ?? null,
      payer_name: body.payerName ?? null,
      received_date: body.receivedDate ?? new Date().toISOString(),
      notes: body.notes ?? null,
      status: "received",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
