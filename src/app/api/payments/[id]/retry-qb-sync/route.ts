import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { syncPaymentToQb } from "@/lib/qb/sync/stripe-payment-bridge";
import { createServiceClient } from "@/lib/supabase-api";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authSupabase = await createServerSupabaseClient();
  const gate = await requirePermission(authSupabase, "record_payments");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const supabase = createServiceClient();

  // Mark pending before attempting, so the UI badge flips quickly.
  await supabase
    .from("payments")
    .update({
      quickbooks_sync_status: "pending",
      quickbooks_sync_attempted_at: new Date().toISOString(),
      quickbooks_sync_error: null,
    })
    .eq("id", id);

  try {
    await syncPaymentToQb(id);
    return NextResponse.json({ ok: true, status: "synced" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("payments")
      .update({
        quickbooks_sync_status: "failed",
        quickbooks_sync_error: msg,
        quickbooks_sync_attempted_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json({ error: msg, status: "failed" }, { status: 500 });
  }
}
