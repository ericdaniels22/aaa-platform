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
  const { data: pr } = await supabase
    .from("payment_requests")
    .select("receipt_pdf_path")
    .eq("id", id)
    .maybeSingle<{ receipt_pdf_path: string | null }>();
  if (!pr?.receipt_pdf_path) {
    return NextResponse.json({ error: "no receipt PDF" }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from("receipts")
    .createSignedUrl(pr.receipt_pdf_path, 300);
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "signed URL failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ url: data.signedUrl });
}
