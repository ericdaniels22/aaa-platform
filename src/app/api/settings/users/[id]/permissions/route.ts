import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";

// GET /api/settings/users/[id]/permissions
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

  const { data, error } = await service
    .from("user_permissions")
    .select("permission_key, granted")
    .eq("user_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const permsMap: Record<string, boolean> = {};
  for (const p of data || []) {
    permsMap[p.permission_key] = p.granted;
  }

  return NextResponse.json(permsMap);
}

// PUT /api/settings/users/[id]/permissions
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

  const upserts = Object.entries(body).map(([permission_key, granted]) => ({
    user_id: id,
    permission_key,
    granted,
  }));

  const { error } = await service
    .from("user_permissions")
    .upsert(upserts, { onConflict: "user_id,permission_key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
