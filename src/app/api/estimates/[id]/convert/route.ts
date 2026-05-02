import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";
import { convertEstimateToInvoice } from "@/lib/conversion";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "convert_estimates");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  try {
    const result = await convertEstimateToInvoice(supabase, id);
    if (result.ok) {
      return NextResponse.json({
        new_invoice_id: result.newInvoiceId,
        new_invoice_number: result.newInvoiceNumber,
      });
    }
    if (result.code === "estimate_already_converted") {
      return NextResponse.json(
        {
          error: "estimate_already_converted",
          existing_invoice_id: result.existingInvoiceId,
          existing_invoice_number: result.existingInvoiceNumber,
        },
        { status: 409 },
      );
    }
    if (result.code === "estimate_not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (result.code === "estimate_not_approved") {
      return NextResponse.json(
        { error: "estimate_not_approved", message: "Estimate must be approved before converting." },
        { status: 400 },
      );
    }
    return apiDbError(result.message ?? "internal", "POST /api/estimates/[id]/convert");
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "POST /api/estimates/[id]/convert");
  }
}
