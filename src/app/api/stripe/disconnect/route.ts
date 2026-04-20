import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";

export async function POST(_req: NextRequest) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "access_settings");
  if (!gate.ok) return gate.response;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("stripe_connection")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
