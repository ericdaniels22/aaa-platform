import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// POST /api/email/attachments/upload — upload a file for composing
// Returns { id, filename, content_type, file_size, storage_path }
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const timestamp = Date.now();
  const storagePath = `drafts/${timestamp}-${file.name}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from("email-attachments")
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  return NextResponse.json({
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    file_size: file.size,
    storage_path: storagePath,
  });
}
