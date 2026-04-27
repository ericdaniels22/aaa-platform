import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// GET /api/email/attachments/[id] — download an attachment
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  // Get attachment metadata
  const { data: attachment, error } = await supabase
    .from("email_attachments")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !attachment || !attachment.storage_path) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  // Download from storage
  const { data: fileData, error: dlError } = await supabase.storage
    .from("email-attachments")
    .download(attachment.storage_path);

  if (dlError || !fileData) {
    return NextResponse.json({ error: "File not found in storage" }, { status: 404 });
  }

  const arrayBuffer = await fileData.arrayBuffer();

  return new NextResponse(arrayBuffer, {
    headers: {
      "Content-Type": attachment.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
      "Content-Length": String(arrayBuffer.byteLength),
    },
  });
}
