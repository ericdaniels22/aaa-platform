// Batch processor for qb_sync_log queued rows. Invoked from the cron
// endpoint (daily) and the manual "Sync now" button.
//
// Ordering rules:
//   * Customer rows before sub_customer rows.
//   * Within each entity type, oldest first.
//   * Rows with depends_on_log_id waiting on an unresolved parent are
//     skipped this tick; they'll get picked up on the next run once
//     the parent is synced.
//   * Rows with next_retry_at in the future are also skipped.
//
// Cap: PROCESS_BATCH_LIMIT rows per invocation. QBO rate limit is 500
// req/min/company — we stay far under that.
//
// Retry policy on failure: exponential backoff in minutes: 2, 4, 8, 16, 32.
// After retry_count = 5, the row stops auto-retrying; the user must click
// Retry on the Fix modal.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken, getActiveConnection } from "@/lib/qb/tokens";
import { syncCustomer, syncSubCustomer } from "./customers";
import type { SyncMode } from "./customers";
import type { QbSyncLogRow } from "@/lib/qb/types";

const PROCESS_BATCH_LIMIT = 50;
const MAX_RETRIES = 5;
const BACKOFF_MINUTES = [2, 4, 8, 16, 32];

export interface ProcessResult {
  processed: number;
  synced: number;
  skipped: number;
  failed: number;
  deferred: number;
  reason?: "no_connection" | "setup_incomplete" | "connection_inactive";
}

export async function processQueue(
  supabase: SupabaseClient,
): Promise<ProcessResult> {
  const connection = await getActiveConnection(supabase);
  if (!connection) {
    return emptyResult("no_connection");
  }
  if (!connection.sync_start_date || !connection.setup_completed_at) {
    return emptyResult("setup_incomplete");
  }

  const mode: SyncMode = connection.dry_run_mode ? "dry_run" : "live";
  // Only fetch a token if we're going live. Dry-run never hits QB.
  const token = mode === "live" ? await getValidAccessToken(supabase) : null;
  if (mode === "live" && !token) {
    return emptyResult("connection_inactive");
  }

  const nowIso = new Date().toISOString();

  // Grab candidates. Customers first (order by created_at), then sub_customers.
  const { data: rows } = await supabase
    .from("qb_sync_log")
    .select("*")
    .eq("status", "queued")
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order("entity_type", { ascending: true }) // 'customer' < 'sub_customer' alphabetically
    .order("created_at", { ascending: true })
    .limit(PROCESS_BATCH_LIMIT);

  const queue = (rows ?? []) as QbSyncLogRow[];

  const result: ProcessResult = {
    processed: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };

  for (const row of queue) {
    result.processed += 1;

    // Dependency guard — skip if parent still queued / failed.
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
      const outcome =
        row.entity_type === "customer"
          ? await syncCustomer(supabase, token, mode, row.entity_id, row.action)
          : row.entity_type === "sub_customer"
            ? await syncSubCustomer(
                supabase,
                token,
                mode,
                row.entity_id,
                row.action,
              )
            : null;

      if (!outcome) {
        // invoice/payment entities reserved for 16d — leave queued.
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
          qb_entity_id: outcome.qbEntityId ?? null,
          synced_at: new Date().toISOString(),
          error_message: null,
          error_code: null,
        })
        .eq("id", row.id);

      if (outcome.status === "synced") result.synced += 1;
      else result.skipped += 1;
    } catch (err) {
      result.failed += 1;
      const next = nextRetry(row.retry_count);
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : null;
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
      // If we saw an AuthenticationFailure during a live run, the token
      // helper already marked the connection inactive; abort the rest of
      // the batch so we don't cascade failures.
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

function nextRetry(currentRetryCount: number): string | null {
  if (currentRetryCount >= MAX_RETRIES) return null;
  const minutes = BACKOFF_MINUTES[currentRetryCount] ?? 32;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function emptyResult(reason: ProcessResult["reason"]): ProcessResult {
  return { processed: 0, synced: 0, skipped: 0, failed: 0, deferred: 0, reason };
}
