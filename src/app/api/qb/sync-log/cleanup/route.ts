// POST /api/qb/sync-log/cleanup
// Deletes synced rows older than 90 days. Keeps failed/queued rows
// regardless of age. Admin only.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requireAdmin } from "@/lib/qb/auth";

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return gate.response;

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const service = createServiceClient();
  const { error, count } = await service
    .from("qb_sync_log")
    .delete({ count: "exact" })
    .in("status", ["synced", "skipped_dry_run"])
    .lt("synced_at", cutoff);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
