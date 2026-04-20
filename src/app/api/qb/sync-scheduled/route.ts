import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { processQueue } from "@/lib/qb/sync/processor";

// GET /api/qb/sync-scheduled — Vercel Cron endpoint. Runs daily (Hobby
// plan cap; 16d will tighten to 5-min on Pro). Authenticates via
// Authorization: Bearer <CRON_SECRET>, same as /api/contracts/reminders.
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const service = createServiceClient();
  const result = await processQueue(service);
  const durationMs = Date.now() - startedAt;
  console.log(
    `[qb-sync-scheduled] processed=${result.processed} synced=${result.synced} skipped=${result.skipped} failed=${result.failed} deferred=${result.deferred} reason=${result.reason ?? "-"} durationMs=${durationMs}`,
  );
  return NextResponse.json({ ok: true, ...result, durationMs });
}
