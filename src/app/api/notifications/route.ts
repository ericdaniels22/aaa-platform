import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// GET /api/notifications?userId=xxx&limit=20
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "20");

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get unread count
  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  return NextResponse.json({ notifications: data || [], unread_count: count || 0 });
}

// POST /api/notifications — create notification
export async function POST(request: Request) {
  const { user_id, type, title, body, job_id } = await request.json();

  if (!type || !title) {
    return NextResponse.json({ error: "type and title required" }, { status: 400 });
  }

  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("notifications")
    .insert({ user_id: user_id || null, type, title, body: body || null, job_id: job_id || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

// PATCH /api/notifications — mark as read
export async function PATCH(request: Request) {
  const { id, mark_all_read, user_id } = await request.json();

  const supabase = createApiClient();

  if (mark_all_read && user_id) {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user_id)
      .eq("is_read", false);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (id) {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "id or mark_all_read required" }, { status: 400 });
}
