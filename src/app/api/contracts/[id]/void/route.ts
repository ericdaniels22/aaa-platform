import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { stampVoidWatermark } from "@/lib/contracts/pdf-void-watermark";
import type { Contract } from "@/lib/contracts/types";

// POST /api/contracts/[id]/void
// Body: { reason?: string }
// Build 15c additions:
//   * Blocks voids when any invoice on the same job has a recorded payment.
//     Rationale: a signed work authorization is the basis for billing;
//     voiding after payment breaks the audit chain. Eric has to refund or
//     void the payment first.
//   * For contracts that are already 'signed', downloads the stored PDF,
//     stamps a diagonal "VOIDED" watermark, and re-uploads at the same
//     path before flipping status. Preserves signed_at + signed_pdf_path
//     for audit.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createServerSupabaseClient();
  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  const reason = (body.reason || "").toString().slice(0, 500) || null;

  const supabase = createServiceClient();

  const { data: contract, error: loadErr } = await supabase
    .from("contracts")
    .select("id, job_id, status, signed_pdf_path")
    .eq("id", id)
    .maybeSingle<Pick<Contract, "id" | "job_id" | "status" | "signed_pdf_path">>();
  if (loadErr || !contract) {
    return NextResponse.json({ error: loadErr?.message || "Contract not found" }, { status: 404 });
  }
  if (contract.status === "voided") {
    return NextResponse.json({ error: "Already voided" }, { status: 409 });
  }

  // --- Block if any invoice on this job has a payment on record ---
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id")
    .eq("job_id", contract.job_id);
  const invoiceIds = (invoices ?? []).map((r: { id: string }) => r.id);
  if (invoiceIds.length > 0) {
    const { count: paymentCount } = await supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .in("invoice_id", invoiceIds);
    if ((paymentCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot void this contract — related invoices have recorded payments. Refund or void payments first.",
        },
        { status: 409 },
      );
    }
  }

  // --- If already signed, watermark the stored PDF in place ---
  if (contract.status === "signed" && contract.signed_pdf_path) {
    try {
      const dl = await supabase.storage
        .from("contracts")
        .download(contract.signed_pdf_path);
      if (!dl.data) throw new Error("Failed to load existing PDF");
      const existing = new Uint8Array(await dl.data.arrayBuffer());
      const stamped = await stampVoidWatermark(existing);
      const { error: upErr } = await supabase.storage
        .from("contracts")
        .upload(contract.signed_pdf_path, stamped, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw new Error(upErr.message);
    } catch (e) {
      return NextResponse.json(
        {
          error: `Failed to watermark signed PDF: ${e instanceof Error ? e.message : String(e)}`,
        },
        { status: 500 },
      );
    }
  }

  const { error } = await supabase.rpc("void_contract", {
    p_contract_id: id,
    p_voided_by: user.id,
    p_reason: reason,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
