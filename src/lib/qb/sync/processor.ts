// Batch processor for qb_sync_log queued rows. Invoked from the cron
// endpoint (daily) and the manual "Sync now" button.
//
// Concurrency: wraps the entire run in a Postgres advisory lock so two
// invocations never process rows simultaneously. If the lock is held,
// returns early with reason = "already_running".
//
// Ordering rules:
//   * customer < sub_customer < invoice < payment
//   * Within each entity type, oldest first.
//   * Rows with depends_on_log_id waiting on an unresolved parent are
//     skipped this tick.
//   * Rows with next_retry_at in the future are also skipped.
//
// Cap: PROCESS_BATCH_LIMIT rows per invocation.
//
// Retry policy: exponential backoff in minutes per spec: 5, 25, 120, 600, 1440.
// ThrottleExceeded errors override to a flat 5 minutes so we recover fast.
// After retry_count = 5, the row stops auto-retrying.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken, getActiveConnection } from "@/lib/qb/tokens";
import { syncCustomer, syncSubCustomer } from "./customers";
import { syncInvoice, voidInvoiceSync } from "./invoices";
import { syncPayment, deletePaymentSync } from "./payments";
import type { SyncMode } from "./customers";
import type { QbSyncLogRow } from "@/lib/qb/types";

const PROCESS_BATCH_LIMIT = 50;
const MAX_RETRIES = 5;
const BACKOFF_MINUTES = [5, 25, 120, 600, 1440];
const SCHEDULER_LOCK_KEY = 4216042;

export interface ProcessResult {
  processed: number;
  synced: number;
  skipped: number;
  failed: number;
  deferred: number;
  reason?: "no_connection" | "setup_incomplete" | "connection_inactive" | "already_running";
}

async function tryLock(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.rpc("try_acquire_advisory_lock", {
    p_key: SCHEDULER_LOCK_KEY,
  });
  return data === true;
}

async function releaseLock(supabase: SupabaseClient): Promise<void> {
  await supabase.rpc("release_advisory_lock", { p_key: SCHEDULER_LOCK_KEY });
}

export async function processQueue(
  supabase: SupabaseClient,
): Promise<ProcessResult> {
  const acquired = await tryLock(supabase);
  if (!acquired) {
    return emptyResult("already_running");
  }
  try {
    return await runInsideLock(supabase);
  } finally {
    await releaseLock(supabase);
  }
}

async function runInsideLock(supabase: SupabaseClient): Promise<ProcessResult> {
  const connection = await getActiveConnection(supabase);
  if (!connection) return emptyResult("no_connection");
  if (!connection.sync_start_date || !connection.setup_completed_at) {
    return emptyResult("setup_incomplete");
  }

  const mode: SyncMode = connection.dry_run_mode ? "dry_run" : "live";
  const token = mode === "live" ? await getValidAccessToken(supabase) : null;
  if (mode === "live" && !token) return emptyResult("connection_inactive");

  const nowIso = new Date().toISOString();

  // Order expression: we want customer < sub_customer < invoice < payment.
  // Alphabetical sort gives: customer < invoice < payment < sub_customer — wrong.
  // Fetch all candidates, then sort client-side with an explicit order map.
  const { data: rows } = await supabase
    .from("qb_sync_log")
    .select("*")
    .eq("status", "queued")
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(PROCESS_BATCH_LIMIT * 2); // oversample — we'll slice after sort

  const typeOrder: Record<string, number> = {
    customer: 0,
    sub_customer: 1,
    invoice: 2,
    payment: 3,
  };
  const queue = ((rows ?? []) as QbSyncLogRow[])
    .sort((a, b) => {
      const d = (typeOrder[a.entity_type] ?? 99) - (typeOrder[b.entity_type] ?? 99);
      if (d !== 0) return d;
      return a.created_at.localeCompare(b.created_at);
    })
    .slice(0, PROCESS_BATCH_LIMIT);

  const result: ProcessResult = {
    processed: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };

  for (const row of queue) {
    result.processed += 1;

    if (row.depends_on_log_id) {
      const { data: parent } = await supabase
        .from("qb_sync_log")
        .select("status")
        .eq("id", row.depends_on_log_id)
        .maybeSingle<{ status: string }>();
      if (!parent || parent.status === "queued" || parent.status === "failed") {
        result.deferred += 1;
        continue;
      }
    }

    try {
      let outcome:
        | { status: "synced" | "skipped_dry_run" | "deferred"; payload: unknown; qbEntityId?: string; reason?: string }
        | null = null;

      if (row.entity_type === "customer") {
        outcome = await syncCustomer(supabase, token, mode, row.entity_id, row.action);
      } else if (row.entity_type === "sub_customer") {
        outcome = await syncSubCustomer(supabase, token, mode, row.entity_id, row.action);
      } else if (row.entity_type === "invoice") {
        if (row.action === "void") {
          outcome = await voidInvoiceSync(supabase, token, mode, row.entity_id);
        } else {
          outcome = await syncInvoice(supabase, token, mode, row.entity_id, row.action);
        }
      } else if (row.entity_type === "payment") {
        if (row.action === "delete") {
          const snapshot = row.payload as { qb_payment_id?: string | null } | null;
          outcome = await deletePaymentSync(
            token,
            mode,
            snapshot?.qb_payment_id ?? row.qb_entity_id ?? null,
          );
        } else {
          outcome = await syncPayment(supabase, token, mode, row.entity_id, row.action);
        }
      }

      if (!outcome) {
        result.deferred += 1;
        continue;
      }

      if (outcome.status === "deferred") {
        result.deferred += 1;
        continue;
      }

      await supabase
        .from("qb_sync_log")
        .update({
          status: outcome.status,
          payload: outcome.payload,
          qb_entity_id: outcome.qbEntityId ?? row.qb_entity_id ?? null,
          synced_at: new Date().toISOString(),
          error_message: outcome.reason ?? null,
          error_code: null,
        })
        .eq("id", row.id);

      if (outcome.status === "synced") result.synced += 1;
      else result.skipped += 1;
    } catch (err) {
      result.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : null;
      const isThrottle = code === "ThrottleExceeded" || /429|throttle|rate/i.test(message);
      const next = nextRetry(row.retry_count, isThrottle);
      await supabase
        .from("qb_sync_log")
        .update({
          status: next ? "queued" : "failed",
          error_message: message,
          error_code: code,
          retry_count: row.retry_count + 1,
          next_retry_at: next,
        })
        .eq("id", row.id);
      if (code === "AuthenticationFailure") break;
    }
  }

  if (result.synced > 0) {
    await supabase
      .from("qb_connection")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", connection.id);
  }

  return result;
}

function nextRetry(currentRetryCount: number, isThrottle: boolean): string | null {
  if (currentRetryCount >= MAX_RETRIES) return null;
  const minutes = isThrottle ? 5 : (BACKOFF_MINUTES[currentRetryCount] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1]);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function emptyResult(reason: ProcessResult["reason"]): ProcessResult {
  return { processed: 0, synced: 0, skipped: 0, failed: 0, deferred: 0, reason };
}
