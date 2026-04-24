import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// PATCH /api/settings/users/[id] — update user profile. Role updates land
// on user_organizations (scoped to the active org) not user_profiles, since
// build48 dropped user_profiles.role.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  let service;
  try {
    service = createServiceClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Service client unavailable" },
      { status: 500 }
    );
  }

  const profileUpdates: Record<string, unknown> = {};
  if (body.full_name !== undefined) profileUpdates.full_name = body.full_name;
  if (body.phone !== undefined) profileUpdates.phone = body.phone || null;
  if (body.is_active !== undefined) profileUpdates.is_active = body.is_active;

  if (Object.keys(profileUpdates).length > 0) {
    const { error } = await service
      .from("user_profiles")
      .update(profileUpdates)
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.role !== undefined) {
    const supabase = await createServerSupabaseClient();
    const orgId = await getActiveOrganizationId(supabase);
    const { error } = await service
      .from("user_organizations")
      .update({ role: body.role })
      .eq("user_id", id)
      .eq("organization_id", orgId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If deactivating, also ban the auth user
  if (body.is_active === false) {
    await service.auth.admin.updateUserById(id, { ban_duration: "876000h" }); // ~100 years
  } else if (body.is_active === true) {
    await service.auth.admin.updateUserById(id, { ban_duration: "none" });
  }

  return NextResponse.json({ success: true });
}
