import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// GET /api/email/thread/[threadId] — get all emails in a thread
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("emails")
    .select("*, job:jobs(id, job_number, property_address), attachments:email_attachments(*)")
    .eq("thread_id", threadId)
    .order("received_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
