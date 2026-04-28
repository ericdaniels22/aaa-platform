// DELETE /api/jobs/[id] — hard-delete (force-purge) a job.
// Removes every storage object the job owns (photos, job files, photo
// reports, contracts, expense receipts) then deletes the jobs row, which
// cascades to all child tables with FK ON DELETE CASCADE. Restricted to
// admin/office_staff per the same gate as soft-delete.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireJobsDelete } from "@/lib/jobs/auth";
import { purgeJobStorage } from "@/lib/jobs/purge";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const gate = await requireJobsDelete(supabase);
  if (!gate.ok) return gate.response;

  const { storageRemoved, storageErrors } = await purgeJobStorage(supabase, id);

  const { error: deleteError } = await supabase.from("jobs").delete().eq("id", id);
  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message, storageRemoved, storageErrors },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, storageRemoved, storageErrors });
}
