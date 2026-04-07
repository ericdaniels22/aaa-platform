import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// GET /api/email/counts?accountId=... — get unread counts per folder
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId"); // null = all accounts

  const supabase = createApiClient();

  const folders = ["inbox", "sent", "drafts", "trash", "spam", "archive"];
  const counts: Record<string, { total: number; unread: number }> = {};

  for (const folder of folders) {
    let totalQuery = supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("folder", folder);

    let unreadQuery = supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("folder", folder)
      .eq("is_read", false);

    if (accountId) {
      totalQuery = totalQuery.eq("account_id", accountId);
      unreadQuery = unreadQuery.eq("account_id", accountId);
    }

    const [totalResult, unreadResult] = await Promise.all([totalQuery, unreadQuery]);

    counts[folder] = {
      total: totalResult.count || 0,
      unread: unreadResult.count || 0,
    };
  }

  // Starred count (across all folders)
  let starredQuery = supabase
    .from("emails")
    .select("id", { count: "exact", head: true })
    .eq("is_starred", true);

  if (accountId) {
    starredQuery = starredQuery.eq("account_id", accountId);
  }

  const starredResult = await starredQuery;
  counts.starred = { total: starredResult.count || 0, unread: 0 };

  return NextResponse.json(counts);
}
