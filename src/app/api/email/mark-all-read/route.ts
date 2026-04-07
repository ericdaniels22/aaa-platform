import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// POST /api/email/mark-all-read — mark all emails in a folder as read
// Body: { folder: string, accountId?: string }
export async function POST(request: NextRequest) {
  const { folder, accountId } = await request.json();

  if (!folder) {
    return NextResponse.json({ error: "folder is required" }, { status: 400 });
  }

  const supabase = createApiClient();

  let query = supabase
    .from("emails")
    .update({ is_read: true })
    .eq("is_read", false)
    .eq("folder", folder);

  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  const { error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
