import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// GET /api/jobs/search?q=...&limit=10
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").replace(/[%,.*()]/g, "");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10") || 10, 1), 50);

  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("jobs")
    .select("id, job_number, property_address")
    .not("status", "eq", "cancelled")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (q) {
    query = query.or(
      `job_number.ilike.%${q}%,property_address.ilike.%${q}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: data || [] });
}
