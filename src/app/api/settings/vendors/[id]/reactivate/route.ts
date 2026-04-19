import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

async function requireManageVendors() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "admin") return { ok: true as const };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "manage_vendors").maybeSingle();
  if (perm?.granted) return { ok: true as const };
  return { ok: false as const, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireManageVendors();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const service = createServiceClient();
  const { error } = await service.from("vendors").update({ is_active: true }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
