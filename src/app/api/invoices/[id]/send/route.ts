// POST /api/invoices/[id]/send
// Transitions draft → sent, stamps sent_at. The DB trigger handles QB enqueue.
// Called by the invoice detail page's onSent callback after the email composer
// reports a successful send.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import type { InvoiceRow } from "@/lib/invoices/types";

export async function POST(
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
    return NextResponse.json({ error: "only draft invoices can be sent" }, { status: 400 });
  }

  const { data: updated, error } = await service
    .from("invoices")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single<InvoiceRow>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(updated);
}
