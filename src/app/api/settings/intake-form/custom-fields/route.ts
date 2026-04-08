import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// GET /api/settings/intake-form/custom-fields?jobId=xxx
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("job_custom_fields")
    .select("*")
    .eq("job_id", jobId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
