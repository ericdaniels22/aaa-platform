import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// GET /api/settings/contract-templates — list all templates (active + archived).
export async function GET() {
  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .select(
      "id, name, description, default_signer_count, is_active, updated_at",
    )
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/settings/contract-templates — create a new blank template.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name: string = (body?.name || "Untitled Template").toString().slice(0, 120);

  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .insert({
      name,
      description: body?.description ?? null,
      content: {
        type: "doc",
        content: [{ type: "paragraph" }],
      },
      content_html: "",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
