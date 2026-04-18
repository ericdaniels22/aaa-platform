import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// GET /api/settings/contract-templates/[id]
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json(data);
}

// PATCH /api/settings/contract-templates/[id] — update any of the editable
// fields. Increments version whenever content changes so the send flow in
// Build 15b can snapshot which template revision produced a given contract.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const update: Record<string, unknown> = {};
  if (typeof body.name === "string") update.name = body.name.slice(0, 120);
  if (body.description === null || typeof body.description === "string") {
    update.description = body.description;
  }
  if (body.default_signer_count === 1 || body.default_signer_count === 2) {
    update.default_signer_count = body.default_signer_count;
  }
  if (typeof body.signer_role_label === "string") {
    update.signer_role_label = body.signer_role_label.slice(0, 120);
  }
  if (typeof body.is_active === "boolean") update.is_active = body.is_active;

  const contentChanged = body.content !== undefined || body.content_html !== undefined;
  if (body.content !== undefined) update.content = body.content;
  if (typeof body.content_html === "string") update.content_html = body.content_html;

  const supabase = createApiClient();

  if (contentChanged) {
    // Atomic version bump alongside the content update.
    const { data: existing, error: fetchErr } = await supabase
      .from("contract_templates")
      .select("version")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!existing) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    update.version = (existing.version ?? 1) + 1;
  }

  const { data, error } = await supabase
    .from("contract_templates")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/settings/contract-templates/[id] — soft archive by flipping
// is_active=false. Templates are never hard-deleted because signed contracts
// in Build 15b will reference them historically.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const { error } = await supabase
    .from("contract_templates")
    .update({ is_active: false })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
