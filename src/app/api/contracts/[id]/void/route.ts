import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

// POST /api/contracts/[id]/void
// Body: { reason?: string }
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
