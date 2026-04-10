import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// PATCH /api/email/bulk — bulk update emails
// Body: { ids: string[], action: "mark_read" | "mark_unread" | "archive" | "trash" | "assign_job", jobId?: string }
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { ids, action, jobId } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const supabase = createApiClient();
  let updates: Record<string, unknown> = {};

  switch (action) {
    case "mark_read":
      updates = { is_read: true };
      break;
    case "mark_unread":
      updates = { is_read: false };
      break;
    case "archive":
      updates = { folder: "archive" };
      break;
    case "trash":
      updates = { folder: "trash" };
      break;
    case "assign_job":
      if (!jobId) {
        return NextResponse.json({ error: "jobId required for assign_job" }, { status: 400 });
      }
      updates = { job_id: jobId, matched_by: "manual" };
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("emails")
    .update(updates)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ updated: count ?? ids.length });
}
