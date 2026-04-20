// PATCH  /api/payments/[id]   — edit. Trigger handles QB update enqueue.
// DELETE /api/payments/[id]   — delete. Trigger captures snapshot before delete.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

interface PatchBody {
  amount?: number;
  method?: string;
  source?: string;
  receivedDate?: string | null;
  referenceNumber?: string | null;
  payerName?: string | null;
  notes?: string | null;
  status?: "received" | "pending" | "due";
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

  const patch: Record<string, unknown> = {};
  if (typeof body.amount === "number") patch.amount = body.amount;
  if (typeof body.method === "string") patch.method = body.method;
  if (typeof body.source === "string") patch.source = body.source;
  if (body.receivedDate !== undefined) patch.received_date = body.receivedDate;
  if (body.referenceNumber !== undefined) patch.reference_number = body.referenceNumber;
  if (body.payerName !== undefined) patch.payer_name = body.payerName;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.status) patch.status = body.status;

  const service = createServiceClient();
  const { data, error } = await service
    .from("payments")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
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
  const { error } = await service.from("payments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
