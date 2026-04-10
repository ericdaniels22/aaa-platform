import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

export async function GET(request: NextRequest) {
  const authSupabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await authSupabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const platform = request.nextUrl.searchParams.get("platform");
  const status = request.nextUrl.searchParams.get("status");

  let query = supabase
    .from("marketing_drafts")
    .select("*, image:marketing_assets!image_id(*)")
    .order("created_at", { ascending: false });

  if (platform) {
    query = query.eq("platform", platform);
  }
  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ drafts: data || [] });
}

export async function POST(request: NextRequest) {
  // Accept either cookie auth OR internal service key (for AI tool calls)
  const internalKey = request.headers.get("x-service-key");
  const isInternalCall =
    internalKey && internalKey === process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!isInternalCall) {
    const authSupabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await authSupabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json();
  const { platform, caption, hashtags, image_id, image_brief, conversation_id, created_by } = body;

  if (!platform || !caption) {
    return NextResponse.json(
      { error: "platform and caption are required" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("marketing_drafts")
    .insert({
      platform,
      caption,
      hashtags: hashtags || null,
      image_id: image_id || null,
      image_brief: image_brief || null,
      status: "draft",
      conversation_id: conversation_id || null,
      created_by: created_by || null,
    })
    .select("*, image:marketing_assets!image_id(*)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data });
}

export async function PATCH(request: NextRequest) {
  const authSupabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await authSupabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Only allow specific fields to be updated
  const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.caption !== undefined) allowed.caption = updates.caption;
  if (updates.hashtags !== undefined) allowed.hashtags = updates.hashtags;
  if (updates.status !== undefined) allowed.status = updates.status;
  if (updates.image_id !== undefined) allowed.image_id = updates.image_id || null;
  if (updates.image_brief !== undefined) allowed.image_brief = updates.image_brief;
  if (updates.posted_at !== undefined) allowed.posted_at = updates.posted_at;

  const { data, error } = await supabase
    .from("marketing_drafts")
    .update(allowed)
    .eq("id", id)
    .select("*, image:marketing_assets!image_id(*)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data });
}

export async function DELETE(request: NextRequest) {
  const authSupabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await authSupabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("marketing_drafts")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
