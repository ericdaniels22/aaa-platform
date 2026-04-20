import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requireAdmin } from "@/lib/qb/auth";

// POST /api/qb/sync-log/[id]/retry — manual retry of a failed row.
// Clears retry_count + error fields, flips status to 'queued'. The next
// processor tick (cron or manual sync-now) picks it up.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const service = createServiceClient();
  const { error } = await service
    .from("qb_sync_log")
    .update({
      status: "queued",
      retry_count: 0,
      next_retry_at: null,
      error_message: null,
      error_code: null,
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
