import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { randomUUID } from "crypto";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// GET /api/jobs/[id]/files — list files for a job (scoped to active org).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("job_files")
    .select("*")
    .eq("organization_id", await getActiveOrganizationId(supabase))
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

// POST /api/jobs/[id]/files — upload one or more files
// Returns { succeeded: JobFile[], failed: { filename: string, error: string }[] }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;
  const formData = await request.formData();
  const files = formData.getAll("file") as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);
  const succeeded: unknown[] = [];
  const failed: { filename: string; error: string }[] = [];

  for (const file of files) {
    try {
      const uuid = randomUUID();
      // Org-prefixed path to match the post-18a rename layout.
      const storagePath = `${orgId}/${jobId}/${uuid}-${file.name}`;

      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from("job-files")
        .upload(storagePath, arrayBuffer, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        failed.push({ filename: file.name, error: uploadError.message });
        continue;
      }

      const { data: row, error: insertError } = await supabase
        .from("job_files")
        .insert({
          organization_id: orgId,
          job_id: jobId,
          filename: file.name,
          storage_path: storagePath,
          size_bytes: file.size,
          mime_type: file.type || "application/octet-stream",
        })
        .select()
        .single();

      if (insertError) {
        // Roll back the storage upload so we don't orphan the object
        await supabase.storage.from("job-files").remove([storagePath]);
        failed.push({ filename: file.name, error: insertError.message });
        continue;
      }

      succeeded.push(row);
    } catch (e) {
      failed.push({
        filename: file.name,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  // 200 = all good, 207 = partial, 500 = all failed
  const status =
    failed.length === 0 ? 200 : succeeded.length === 0 ? 500 : 207;

  return NextResponse.json({ succeeded, failed }, { status });
}
