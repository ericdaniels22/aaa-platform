// POST /api/jobs/[id]/restore — pull a job back out of the trash.
// Clears jobs.deleted_at. Idempotent: a job that's already active is a
// no-op.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireJobsDelete } from "@/lib/jobs/auth";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const gate = await requireJobsDelete(supabase);
  if (!gate.ok) return gate.response;

  const { error } = await supabase
    .from("jobs")
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
