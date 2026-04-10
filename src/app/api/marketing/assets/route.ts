import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function GET(request: NextRequest) {
  const authSupabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await authSupabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const tags = request.nextUrl.searchParams.get("tags");

  let query = supabase
    .from("marketing_assets")
    .select("*")
    .order("created_at", { ascending: false });

  if (tags) {
    const tagArr = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagArr.length > 0) {
      query = query.overlaps("tags", tagArr);
    }
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ assets: data || [] });
}

export async function POST(request: NextRequest) {
  const authSupabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await authSupabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const description = formData.get("description") as string | null;
  const tagsStr = formData.get("tags") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Use PNG, JPG, WebP, or GIF." },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum 10MB." },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const ext = file.name.split(".").pop() || "png";
  const storagePath = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("marketing-assets")
    .upload(storagePath, buffer, { contentType: file.type });

  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  const tags = tagsStr
    ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const { data, error: insertError } = await supabase
    .from("marketing_assets")
    .insert({
      file_name: file.name,
      storage_path: storagePath,
      description: description || null,
      tags,
      uploaded_by: user.id,
    })
    .select()
    .single();

  if (insertError) {
    // Clean up uploaded file
    await supabase.storage.from("marketing-assets").remove([storagePath]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ asset: data });
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

  // Get the asset to find storage path
  const { data: asset } = await supabase
    .from("marketing_assets")
    .select("storage_path")
    .eq("id", id)
    .single();

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  // Delete from storage
  await supabase.storage.from("marketing-assets").remove([asset.storage_path]);

  // Delete from DB
  const { error } = await supabase
    .from("marketing_assets")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
