import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// GET /api/settings/intake-form — fetch latest form config for the active org.
export async function GET() {
  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("form_config")
    .select("*")
    .eq("organization_id", getActiveOrganizationId())
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || { config: { sections: [] }, version: 0 });
}

// POST /api/settings/intake-form — save new version (org-scoped).
export async function POST(request: Request) {
  const { config } = await request.json();

  if (!config || !config.sections) {
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  }

  const supabase = createApiClient();
  const orgId = getActiveOrganizationId();

  // Get current max version for this org
  const { data: current } = await supabase
    .from("form_config")
    .select("version")
    .eq("organization_id", orgId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (current?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from("form_config")
    .insert({
      organization_id: orgId,
      config,
      version: nextVersion,
      created_by: "admin",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
