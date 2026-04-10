import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";

// GET /api/knowledge/documents — list all knowledge documents
export async function GET(_request: NextRequest) {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("knowledge_documents")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
