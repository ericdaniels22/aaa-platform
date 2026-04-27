import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// GET /api/email/[id] — get a single email
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("emails")
    .select("*, job:jobs(id, job_number, property_address), attachments:email_attachments(*)")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

// PATCH /api/email/[id] — update email (read, starred, job_id)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const supabase = await createServerSupabaseClient();

  const updates: Record<string, unknown> = {};
  if (typeof body.is_read === "boolean") updates.is_read = body.is_read;
  if (typeof body.is_starred === "boolean") updates.is_starred = body.is_starred;
  if (body.job_id !== undefined) {
    updates.job_id = body.job_id || null;
    updates.matched_by = body.job_id ? "manual" : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("emails")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
