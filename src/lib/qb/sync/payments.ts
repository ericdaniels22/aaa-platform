// Payment sync primitives. All payments sync immediately (no status gate).
//
// deletePayment: the platform row is already gone when we run. The trigger
// captured a snapshot into qb_sync_log.payload so we can reach qb_payment_id.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPayment,
  deletePayment as qbDeletePayment,
  getPayment,
  updatePayment,
} from "@/lib/qb/client";
import type { ValidToken } from "@/lib/qb/tokens";
import type {
  QbMappingRow,
  QbPaymentPayload,
  QbSyncAction,
} from "@/lib/qb/types";

export type SyncMode = "dry_run" | "live";

export interface PaymentSyncOutcome {
  status: "synced" | "skipped_dry_run" | "deferred";
  payload: QbPaymentPayload;
  qbEntityId?: string;
  reason?: string;
}

interface PaymentRow {
  id: string;
  invoice_id: string | null;
  job_id: string;
  amount: number;
  method: string;
  received_date: string | null;
  reference_number: string | null;
  notes: string | null;
  qb_payment_id: string | null;
  created_at: string;
}

interface InvoiceRow {
  id: string;
  qb_invoice_id: string | null;
  job_id: string;
}

interface JobRow {
  id: string;
  qb_subcustomer_id: string | null;
}

function toIsoDate(ts: string | null): string | undefined {
  if (!ts) return undefined;
  return ts.slice(0, 10);
}

export async function syncPayment(
  supabase: SupabaseClient,
  token: ValidToken | null,
  mode: SyncMode,
  paymentId: string,
  action: QbSyncAction,
): Promise<PaymentSyncOutcome> {
  const { data: payment } = await supabase
    .from("payments")
    .select(
      "id, invoice_id, job_id, amount, method, received_date, reference_number, notes, qb_payment_id, created_at",
    )
    .eq("id", paymentId)
    .maybeSingle<PaymentRow>();
  if (!payment) throw new Error(`payments row ${paymentId} not found`);

  const connection = token?.connection;
  if (connection?.sync_start_date) {
    const startTs = Date.parse(connection.sync_start_date);
    if (Date.parse(payment.created_at) < startTs) {
      return {
        status: "synced",
        payload: { CustomerRef: { value: "pre_sync_start_date" }, TotalAmt: 0, Line: [] },
        reason: "pre_sync_start_date",
      };
    }
  }

  if (!payment.invoice_id) {
    // No invoice linkage — we don't sync free-standing payments in 16d.
    return {
      status: "synced",
      payload: { CustomerRef: { value: "no_invoice" }, TotalAmt: 0, Line: [] },
      reason: "no_invoice_linkage",
    };
  }

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, qb_invoice_id, job_id")
    .eq("id", payment.invoice_id)
    .maybeSingle<InvoiceRow>();
  if (!invoice) throw new Error(`invoices row ${payment.invoice_id} not found`);
  if (!invoice.qb_invoice_id) {
    return {
      status: "deferred",
      payload: { CustomerRef: { value: "pending" }, TotalAmt: 0, Line: [] },
      reason: "invoice_not_synced",
    };
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, qb_subcustomer_id")
    .eq("id", invoice.job_id)
    .maybeSingle<JobRow>();
  if (!job?.qb_subcustomer_id) {
    return {
      status: "deferred",
      payload: { CustomerRef: { value: "pending" }, TotalAmt: 0, Line: [] },
      reason: "sub_customer_not_synced",
    };
  }

  const { data: mappings } = await supabase
    .from("qb_mappings")
    .select("id, type, platform_value, qb_entity_id, qb_entity_name, created_at, updated_at")
    .eq("type", "payment_method");
  const acctMap = (mappings ?? []) as QbMappingRow[];
  const depositAccount = acctMap.find((m) => m.platform_value === payment.method) ?? null;
  if (!depositAccount) {
    const err = new Error(
      `Payment method "${payment.method}" isn't mapped to a QB deposit account.`,
    );
    (err as Error & { code?: string }).code = "deposit_account_not_mapped";
    throw err;
  }

  const payload: QbPaymentPayload = {
    CustomerRef: { value: job.qb_subcustomer_id },
    TotalAmt: Number(payment.amount),
    Line: [
      {
        Amount: Number(payment.amount),
        LinkedTxn: [{ TxnId: invoice.qb_invoice_id, TxnType: "Invoice" }],
      },
    ],
    DepositToAccountRef: { value: depositAccount.qb_entity_id },
    TxnDate: toIsoDate(payment.received_date),
    PrivateNote: (payment.reference_number || payment.notes || "").slice(0, 4000) || undefined,
  };

  if (mode === "dry_run") {
    return { status: "skipped_dry_run", payload };
  }
  if (!token) throw new Error("live sync requires a valid token");

  if (action === "update" && payment.qb_payment_id) {
    const current = await getPayment(token, payment.qb_payment_id);
    if (!current) {
      const created = await createPayment(token, payload);
      await supabase.from("payments").update({ qb_payment_id: created.id }).eq("id", payment.id);
      return { status: "synced", payload, qbEntityId: created.id };
    }
    const updated = await updatePayment(token, {
      ...payload,
      Id: current.Id,
      SyncToken: current.SyncToken,
    });
    return { status: "synced", payload, qbEntityId: updated.id };
  }

  if (payment.qb_payment_id) {
    return { status: "synced", payload, qbEntityId: payment.qb_payment_id };
  }

  const created = await createPayment(token, payload);
  await supabase.from("payments").update({ qb_payment_id: created.id }).eq("id", payment.id);
  return { status: "synced", payload, qbEntityId: created.id };
}

export async function deletePaymentSync(
  token: ValidToken | null,
  mode: SyncMode,
  snapshotQbPaymentId: string | null,
): Promise<PaymentSyncOutcome> {
  const payload: QbPaymentPayload = {
    CustomerRef: { value: "delete" },
    TotalAmt: 0,
    Line: [],
  };

  if (!snapshotQbPaymentId) {
    return { status: "synced", payload, reason: "never_synced" };
  }
  if (mode === "dry_run") {
    return { status: "skipped_dry_run", payload, qbEntityId: snapshotQbPaymentId };
  }
  if (!token) throw new Error("live sync requires a valid token");

  const current = await getPayment(token, snapshotQbPaymentId);
  if (!current) {
    return { status: "synced", payload, qbEntityId: snapshotQbPaymentId, reason: "qb_record_gone" };
  }
  await qbDeletePayment(token, current.Id, current.SyncToken);
  return { status: "synced", payload, qbEntityId: snapshotQbPaymentId };
}
