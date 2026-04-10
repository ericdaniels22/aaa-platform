import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

// GET /api/knowledge/documents/[id] — get a single document with chunk count
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("knowledge_documents")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

// DELETE /api/knowledge/documents/[id] — delete document, chunks (CASCADE), and storage file
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Auth check
    const authSupabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const supabase = createServiceClient();

    // 1. Get the document to find its storage path
    const { data: doc, error: fetchError } = await supabase
      .from("knowledge_documents")
      .select("id, file_path")
      .eq("id", id)
      .single();

    if (fetchError || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // 2. Delete from storage bucket
    if (doc.file_path) {
      await supabase.storage.from("knowledge-docs").remove([doc.file_path]);
    }

    // 3. Delete the document row (chunks cascade automatically)
    const { error: deleteError } = await supabase
      .from("knowledge_documents")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json(
        { error: `Delete failed: ${deleteError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Knowledge document delete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
