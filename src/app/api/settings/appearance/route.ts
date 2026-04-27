import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const APPEARANCE_KEYS = ["brand_primary", "brand_secondary", "brand_accent"];

// GET /api/settings/appearance — fetch brand color settings
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("company_settings")
    .select("key, value")
    .in("key", APPEARANCE_KEYS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings: Record<string, string> = {};
  for (const row of data || []) {
    settings[row.key] = row.value || "";
  }

  return NextResponse.json(settings);
}

// PUT /api/settings/appearance — save brand color settings
export async function PUT(request: Request) {
  const body = await request.json();
  const supabase = await createServerSupabaseClient();

  for (const key of APPEARANCE_KEYS) {
    if (key in body) {
      const { error } = await supabase
        .from("company_settings")
        .upsert(
          { key, value: String(body[key] || ""), updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );

      if (error) {
        return NextResponse.json(
          { error: `Failed to save ${key}: ${error.message}` },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({ success: true });
}
