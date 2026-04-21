import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// GET /api/settings/company — fetch all company settings for the active org.
export async function GET() {
  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", getActiveOrganizationId());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings: Record<string, string> = {};
  for (const row of data || []) {
    settings[row.key] = row.value || "";
  }

  return NextResponse.json(settings);
}

// PUT /api/settings/company — upsert company settings for the active org.
export async function PUT(request: Request) {
  const body = await request.json();
  const supabase = createApiClient();
  const orgId = getActiveOrganizationId();

  const entries = Object.entries(body).filter(
    ([key]) => typeof key === "string" && key.length > 0
  );

  for (const [key, value] of entries) {
    const { error } = await supabase
      .from("company_settings")
      .upsert(
        { organization_id: orgId, key, value: String(value ?? ""), updated_at: new Date().toISOString() },
        { onConflict: "organization_id,key" }
      );

    if (error) {
      return NextResponse.json(
        { error: `Failed to save ${key}: ${error.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true });
}
