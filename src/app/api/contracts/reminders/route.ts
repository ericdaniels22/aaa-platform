import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  hasRecentReminder,
  sendContractReminder,
} from "@/lib/contracts/reminders";
import type { Contract, ContractSigner, ContractEmailSettings } from "@/lib/contracts/types";

// GET /api/contracts/reminders
// Vercel Cron endpoint, fires hourly (see vercel.json). Reads:
//   Authorization: Bearer <CRON_SECRET>   (Vercel sends this automatically
//     when CRON_SECRET is set as a project env var)
//
// Idempotency: for each contract that's due (next_reminder_at <= now and
// status in sent/viewed), we check contract_events for any reminder_sent
// record within the last hour. If present, skip — this guards against
// Vercel double-firing the cron. The mark_reminder_sent RPC then bumps
// the counter and recomputes next_reminder_at atomically.
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createServiceClient();

  const { data: settings } = await supabase
    .from("contract_email_settings")
    .select("*")
    .limit(1)
    .maybeSingle<ContractEmailSettings>();
  if (!settings) {
    return NextResponse.json(
      { error: "contract_email_settings missing" },
      { status: 500 },
    );
  }
  if (!settings.send_from_email || !settings.send_from_name) {
    // No sender configured — skip quietly; auto-reminders stay off until
    // Eric fills in the Settings → Contracts page.
    return NextResponse.json({ ok: true, sent: 0, skipped: "no_sender" });
  }

  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from("contracts")
    .select("*")
    .in("status", ["sent", "viewed"])
    .not("next_reminder_at", "is", null)
    .lte("next_reminder_at", nowIso);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ contractId: string; status: "sent" | "skipped" | "failed"; reason?: string }> = [];
  for (const contract of (due ?? []) as Contract[]) {
    try {
      if (await hasRecentReminder(supabase, contract.id)) {
        results.push({ contractId: contract.id, status: "skipped", reason: "recent_reminder" });
        continue;
      }
      const { data: signers } = await supabase
        .from("contract_signers")
        .select("*")
        .eq("contract_id", contract.id)
        .order("signer_order");
      if (!signers?.length) {
        results.push({ contractId: contract.id, status: "skipped", reason: "no_signers" });
        continue;
      }
      await sendContractReminder(
        supabase,
        contract,
        signers as ContractSigner[],
        settings,
      );
      results.push({ contractId: contract.id, status: "sent" });
    } catch (e) {
      results.push({
        contractId: contract.id,
        status: "failed",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const sentCount = results.filter((r) => r.status === "sent").length;
  const durationMs = Date.now() - startedAt;
  // Log line picked up by Vercel logs for observability.
  // eslint-disable-next-line no-console
  console.log(
    `[contracts-reminders] due=${(due ?? []).length} sent=${sentCount} durationMs=${durationMs}`,
  );

  return NextResponse.json({ ok: true, sent: sentCount, durationMs, results });
}
