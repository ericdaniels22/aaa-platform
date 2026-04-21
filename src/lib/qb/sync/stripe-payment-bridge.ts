// 17c — entry point called from the Stripe webhook handler. Pushes a Stripe
// payment to QuickBooks (invoice-linked or standalone-deposit) and posts the
// processing fee as a separate expense. Updates quickbooks_sync_status on
// both payments and payment_requests on the way out. On fatal errors (no
// mapping, etc.) throws so the webhook handler's catch block records failure.

import { createServiceClient } from "@/lib/supabase-api";
import { getValidAccessToken } from "@/lib/qb/tokens";
import { syncPayment } from "@/lib/qb/sync/payments";
import { postStripeFee } from "@/lib/qb/sync/stripe-fees";
import type { PaymentRow } from "@/lib/payments/types";

export async function syncPaymentToQb(paymentId: string): Promise<void> {
  const supabase = createServiceClient();

  const token = await getValidAccessToken(supabase);
  if (!token) {
    // No active QB connection — not applicable, not failed.
    const { data: payment } = await supabase
      .from("payments")
      .select("payment_request_id")
      .eq("id", paymentId)
      .maybeSingle<{ payment_request_id: string | null }>();
    await supabase
      .from("payments")
      .update({
        quickbooks_sync_status: "not_applicable",
        quickbooks_sync_attempted_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    if (payment?.payment_request_id) {
      await supabase
        .from("payment_requests")
        .update({ quickbooks_sync_status: "not_applicable" })
        .eq("id", payment.payment_request_id);
    }
    return;
  }

  const outcome = await syncPayment(supabase, token, "live", paymentId, "create");

  if (outcome.status === "deferred") {
    throw new Error(`QB sync deferred: ${outcome.reason ?? "unknown"}`);
  }

  // Post the Stripe fee as a separate expense, if we have fee data.
  const { data: payment } = await supabase
    .from("payments")
    .select("stripe_fee_amount, stripe_charge_id, received_date, payment_request_id")
    .eq("id", paymentId)
    .maybeSingle<
      Pick<
        PaymentRow,
        "stripe_fee_amount" | "stripe_charge_id" | "received_date" | "payment_request_id"
      >
    >();
  if (
    payment?.stripe_fee_amount &&
    payment.stripe_fee_amount > 0 &&
    payment.stripe_charge_id
  ) {
    await postStripeFee(supabase, token, {
      paymentId,
      feeAmount: Number(payment.stripe_fee_amount),
      stripeChargeId: payment.stripe_charge_id,
      paidDate:
        payment.received_date ?? new Date().toISOString().slice(0, 10),
    }).catch((e) => {
      // Fee posting failure is logged but doesn't fail the whole sync —
      // the payment is in QB; the fee can be posted manually by accounting.
      console.warn(
        `[qb] Stripe fee posting failed: ${e instanceof Error ? e.message : e}`,
      );
    });
  }

  const nowIso = new Date().toISOString();
  await supabase
    .from("payments")
    .update({
      quickbooks_sync_status: "synced",
      quickbooks_sync_attempted_at: nowIso,
      qb_payment_id: outcome.qbEntityId ?? null,
    })
    .eq("id", paymentId);
  if (payment?.payment_request_id) {
    await supabase
      .from("payment_requests")
      .update({
        quickbooks_sync_status: "synced",
        quickbooks_sync_attempted_at: nowIso,
        qb_payment_id: outcome.qbEntityId ?? null,
      })
      .eq("id", payment.payment_request_id);
  }
}
