import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

// POST /api/qb/disconnect — mark all active connections inactive. We keep
// the encrypted tokens on the row for audit; a future reconnect creates a
// new row rather than reviving the old one.
export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const service = createServiceClient();
  const { error } = await service
    .from("qb_connection")
    .update({ is_active: false })
    .eq("is_active", true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
