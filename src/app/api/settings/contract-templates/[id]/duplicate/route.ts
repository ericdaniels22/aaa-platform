import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// POST /api/settings/contract-templates/[id]/duplicate
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const orgId = getActiveOrganizationId();

  const { data: source, error: fetchErr } = await supabase
    .from("contract_templates")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!source) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const { data: inserted, error: insertErr } = await supabase
    .from("contract_templates")
    .insert({
      organization_id: orgId,
      name: `${source.name} (Copy)`,
      description: source.description,
      content: source.content,
      content_html: source.content_html,
      default_signer_count: source.default_signer_count,
      signer_role_label: source.signer_role_label,
      is_active: true,
    })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json(inserted, { status: 201 });
}
