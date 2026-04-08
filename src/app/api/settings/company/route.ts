import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// GET /api/settings/company — fetch all company settings as key-value object
export async function GET() {
  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("company_settings")
    .select("key, value");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings: Record<string, string> = {};
  for (const row of data || []) {
    settings[row.key] = row.value || "";
  }

  return NextResponse.json(settings);
}

// PUT /api/settings/company — upsert company settings
export async function PUT(request: Request) {
  const body = await request.json();
  const supabase = createApiClient();

  const entries = Object.entries(body).filter(
    ([key]) => typeof key === "string" && key.length > 0
  );

  for (const [key, value] of entries) {
    const { error } = await supabase
      .from("company_settings")
      .upsert(
        { key, value: String(value ?? ""), updated_at: new Date().toISOString() },
        { onConflict: "key" }
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
