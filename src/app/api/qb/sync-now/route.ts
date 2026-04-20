import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requireAdmin } from "@/lib/qb/auth";
import { processQueue } from "@/lib/qb/sync/processor";

// POST /api/qb/sync-now — manual trigger from the "Sync now" button on
// the QB tab. Runs the same processor the cron uses; returns the result
// so the UI can refresh stat cards and show a toast.
export async function POST() {
  const supabase = await createServerSupabaseClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) return gate.response;

  const service = createServiceClient();
  const result = await processQueue(service);
  return NextResponse.json(result);
}
