import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authSupabase = await createServerSupabaseClient();
  const gate = await requirePermission(authSupabase, "view_billing");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const supabase = createServiceClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, amount")
    .eq("payment_request_id", id)
    .eq("source", "stripe")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; amount: number }>();
  if (!payment) {
    return NextResponse.json({ error: "no Stripe payment" }, { status: 404 });
  }
  const { data: refunds } = await supabase
    .from("refunds")
    .select("amount, status")
    .eq("payment_id", payment.id)
    .in("status", ["pending", "succeeded"]);
  const refundedSum = (refunds ?? []).reduce(
    (s: number, r: { amount: number }) => s + Number(r.amount),
    0,
  );
  const remaining = Number(payment.amount) - refundedSum;
  return NextResponse.json({ remaining, payment_id: payment.id });
}
