import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { resolveMergeFields } from "@/lib/contracts/merge-fields";

// POST /api/settings/contract-templates/preview
// Body: { jobId: string, contentHtml: string }
// Returns the merge-field-resolved HTML plus the list of fields that
// had no data on that job so the modal can flag them to the author.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.jobId !== "string" || typeof body.contentHtml !== "string") {
    return NextResponse.json(
      { error: "jobId and contentHtml are required" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const result = await resolveMergeFields(supabase, body.contentHtml, body.jobId);
  return NextResponse.json(result);
}
