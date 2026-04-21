import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Simple auth gate — any authenticated user can view receipts they are
  // looking at in the admin UI.
  const auth = await createServerSupabaseClient();
  const { data: userData } = await auth.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
