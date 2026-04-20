import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

// GET /api/qb/sync-log?limit=50&offset=0&status=failed
// Paginated log. Admin+manage_accounting reads; service client used so
// encrypted-token RLS on qb_connection doesn't matter here.
// Sort: failed rows first, then newest first (matches the spec's
// "Failed rows float to top" requirement on the QB tab).
export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  const isAdmin = profile?.role === "admin";
  let canManage = isAdmin;
  if (!canManage) {
    const { data: perm } = await supabase
      .from("user_permissions")
      .select("granted")
      .eq("user_id", user.id)
      .eq("permission_key", "manage_accounting")
      .maybeSingle<{ granted: boolean }>();
    canManage = !!perm?.granted;
  }
  if (!canManage) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
  const status = url.searchParams.get("status"); // optional filter

  const service = createServiceClient();
  let query = service
    .from("qb_sync_log")
    .select("*", { count: "exact" })
    .order("status", { ascending: true }) // 'failed' < 'queued' < 'skipped_dry_run' < 'synced'
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    rows: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
