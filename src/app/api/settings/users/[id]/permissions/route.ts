import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// GET /api/settings/users/[id]/permissions — from user_organization_permissions
// scoped to the active org's membership.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let service;
  try {
    service = createServiceClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Service client unavailable" },
      { status: 500 }
    );
  }

  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);
  const { data: membership } = await service
    .from("user_organizations")
    .select("id")
    .eq("user_id", id)
    .eq("organization_id", orgId)
    .maybeSingle<{ id: string }>();
  if (!membership) return NextResponse.json({});

  const { data, error } = await service
    .from("user_organization_permissions")
    .select("permission_key, granted")
    .eq("user_organization_id", membership.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const permsMap: Record<string, boolean> = {};
  for (const p of data || []) {
    permsMap[p.permission_key] = p.granted;
  }

  return NextResponse.json(permsMap);
}

// PUT /api/settings/users/[id]/permissions — writes go to both
// user_organization_permissions (the new source of truth) and the legacy
// user_permissions table so 18a revert is safe.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json() as Record<string, boolean>;

  let service;
  try {
    service = createServiceClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Service client unavailable" },
      { status: 500 }
    );
  }

  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);
  const { data: membership } = await service
    .from("user_organizations")
    .select("id")
    .eq("user_id", id)
    .eq("organization_id", orgId)
    .maybeSingle<{ id: string }>();
  if (!membership) {
    return NextResponse.json({ error: "user is not a member of the active org" }, { status: 404 });
  }

  const uopUpserts = Object.entries(body).map(([permission_key, granted]) => ({
    user_organization_id: membership.id,
    permission_key,
    granted,
  }));
  const upUpserts = Object.entries(body).map(([permission_key, granted]) => ({
    user_id: id,
    permission_key,
    granted,
  }));

  const { error } = await service
    .from("user_organization_permissions")
    .upsert(uopUpserts, { onConflict: "user_organization_id,permission_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await service
    .from("user_permissions")
    .upsert(upUpserts, { onConflict: "user_id,permission_key" });

  return NextResponse.json({ success: true });
}
