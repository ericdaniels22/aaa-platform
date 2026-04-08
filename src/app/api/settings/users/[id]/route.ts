import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";

// PATCH /api/settings/users/[id] — update user profile
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

  const updates: Record<string, unknown> = {};
  if (body.full_name !== undefined) updates.full_name = body.full_name;
  if (body.phone !== undefined) updates.phone = body.phone || null;
  if (body.role !== undefined) updates.role = body.role;
  if (body.is_active !== undefined) updates.is_active = body.is_active;

  if (Object.keys(updates).length > 0) {
    const { error } = await service
      .from("user_profiles")
      .update(updates)
      .eq("id", id);

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
