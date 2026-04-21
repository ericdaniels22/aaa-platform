// 17c Task 18 — posts a Stripe refund as a QB RefundReceipt against the job's
// subcustomer. Called from the charge.refunded webhook handler after the
// refunds row has been flipped to succeeded. Best-effort: the caller swallows
// failures so a mapping miss doesn't derail the webhook.
//
// Note on ItemRef: refund receipts require a SalesItemLineDetail with an
// ItemRef. There is no `qb_mappings.type='refund_item'` row today (may be
// added in future work), so we fall back to Id "1" — the default
// "Services" item that most QB realms ship with. If a realm has deleted
// that item the post will fail and the refund will log an error but the
// rest of the webhook flow (row status flips, emails, notifications)
// still completes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createRefundReceipt } from "@/lib/qb/client";
import type { ValidToken } from "@/lib/qb/tokens";
import type { QbMappingRow } from "@/lib/qb/types";

interface RefundPostingInput {
  refundId: string;
  paymentId: string;
  amount: number;
  paidDate: string; // yyyy-mm-dd
  stripeRefundId: string;
  invoiceId: string | null;
  jobId: string;
}

export interface RefundPostingResult {
  status: "posted" | "skipped";
  qbEntityId?: string;
  reason?: string;
}

export async function postRefundToQb(
  supabase: SupabaseClient,
  token: ValidToken,
  input: RefundPostingInput,
): Promise<RefundPostingResult> {
  // Look up the job's subcustomer.
  const { data: job } = await supabase
    .from("jobs")
    .select("qb_subcustomer_id")
    .eq("id", input.jobId)
    .maybeSingle<{ qb_subcustomer_id: string | null }>();
  if (!job?.qb_subcustomer_id) {
    return { status: "skipped", reason: "sub_customer_not_synced" };
  }

  // Find the deposit (bank) account mapping — same lookup pattern as
  // stripe-fees.ts. The RefundReceipt's DepositToAccountRef is the account
  // the money leaves from.
  const { data: mappings } = await supabase
    .from("qb_mappings")
    .select(
      "id, type, platform_value, qb_entity_id, qb_entity_name, created_at, updated_at",
    )
    .eq("type", "payment_method");
  const deposits = (mappings ?? []) as QbMappingRow[];
  const depositAccount =
    deposits.find((m) => m.platform_value === "stripe_card") ??
    deposits.find((m) => m.platform_value === "stripe_ach");
  if (!depositAccount) {
    return { status: "skipped", reason: "no_deposit_mapping" };
  }

  const payload: Record<string, unknown> = {
    CustomerRef: { value: job.qb_subcustomer_id },
    TotalAmt: input.amount,
    DepositToAccountRef: { value: depositAccount.qb_entity_id },
    TxnDate: input.paidDate,
    PrivateNote: `Stripe refund ${input.stripeRefundId}`,
    Line: [
      {
        Amount: input.amount,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          // See header note — hardcoded to "1" (default Services item).
          // A future `qb_mappings.type='refund_item'` row would let an
          // admin override this per-realm.
          ItemRef: { value: "1" },
        },
      },
    ],
  };

  const created = await createRefundReceipt(token, payload);
  return { status: "posted", qbEntityId: created.id };
}
