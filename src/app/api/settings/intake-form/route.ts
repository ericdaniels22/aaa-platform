import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// GET /api/settings/intake-form — fetch latest form config
export async function GET() {
  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("form_config")
    .select("*")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || { config: { sections: [] }, version: 0 });
}

// POST /api/settings/intake-form — save new version
export async function POST(request: Request) {
  const { config } = await request.json();

  if (!config || !config.sections) {
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  }

  const supabase = createApiClient();

  // Get current max version
  const { data: current } = await supabase
    .from("form_config")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (current?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from("form_config")
    .insert({
      config,
      version: nextVersion,
      created_by: "admin",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
