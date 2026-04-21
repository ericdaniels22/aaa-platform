import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";
import { getStripeClient } from "@/lib/stripe";
import { writePaymentEvent } from "@/lib/payments/activity";
import {
  sendPaymentReceiptEmail,
  sendPaymentInternalNotification,
} from "@/lib/payment-emails";
import { writeNotification } from "@/lib/notifications/write";
import { syncPaymentToQb } from "@/lib/qb/sync/stripe-payment-bridge";
import type { PaymentMergeExtras } from "@/lib/payments/merge-fields";
import type { PaymentRequestRow } from "@/lib/payments/types";

interface HandlerResult {
  paymentRequestId: string | null;
}

export async function handlePaymentIntentSucceeded(
  event: Stripe.Event,
): Promise<HandlerResult> {
  const pi = event.data.object as Stripe.PaymentIntent;
  const paymentRequestId =
    (pi.metadata as Record<string, string> | null)?.payment_request_id ?? null;
  if (!paymentRequestId) {
    console.warn(
      `[stripe/webhook] payment_intent.succeeded ${pi.id} has no metadata.payment_request_id — skipping`,
    );
    return { paymentRequestId: null };
  }

  const supabase = createServiceClient();

  // Load the payment_request
  const { data: pr, error: prErr } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", paymentRequestId)
    .maybeSingle<PaymentRequestRow>();
  if (prErr || !pr) {
    throw new Error(
      `payment_intent.succeeded: payment_request ${paymentRequestId} not found: ${prErr?.message ?? ""}`,
    );
  }

  // Idempotency short-circuit — but only if the prior run completed the
  // payments insert. If the status flip landed but the insert didn't
  // (partial prior run, then releaseEvent + Stripe retry), we need to
  // fall through and retry the insert + side effects.
  if (
    pr.status === "paid" ||
    pr.status === "refunded" ||
    pr.status === "partially_refunded"
  ) {
    const { count: existingPaymentsCount } = await supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("payment_request_id", pr.id)
      .eq("source", "stripe");
    if ((existingPaymentsCount ?? 0) > 0) {
      return { paymentRequestId };
    }
    // Prior run partially completed — the status is set but no payments
    // row exists. Fall through and re-do the insert + side effects.
  }

  // Expand the charge to get fee data
  const { client: stripe } = await getStripeClient();
  const latestChargeId =
    typeof pi.latest_charge === "string"
      ? pi.latest_charge
      : pi.latest_charge?.id;
  let charge: Stripe.Charge | null = null;
  let feeAmount = 0;
  if (latestChargeId) {
    charge = await stripe.charges.retrieve(latestChargeId, {
      expand: ["balance_transaction"],
    });
    const bt = charge.balance_transaction;
    if (bt && typeof bt !== "string" && typeof bt.fee === "number") {
      feeAmount = bt.fee / 100;
    }
  }

  const amountReceived = (pi.amount_received ?? 0) / 100;
  const expected =
    pr.total_charged != null ? Number(pr.total_charged) : Number(pr.amount);
  const amountMismatch = Math.abs(amountReceived - expected) > 0.01;

  const paymentMethodType: "card" | "us_bank_account" =
    (charge?.payment_method_details?.type as string | undefined) ===
    "us_bank_account"
      ? "us_bank_account"
      : "card";
  const methodColumn =
    paymentMethodType === "us_bank_account" ? "stripe_ach" : "stripe_card";

  const nowIso = new Date().toISOString();

  // 1. Flip payment_requests to paid
  const { error: upErr } = await supabase
    .from("payment_requests")
    .update({
      status: "paid",
      paid_at: nowIso,
      payment_method_type: paymentMethodType,
      stripe_charge_id: charge?.id ?? null,
      stripe_receipt_url: charge?.receipt_url ?? null,
      quickbooks_sync_status: "pending",
    })
    .eq("id", paymentRequestId)
    .eq("status", pr.status);
  if (upErr) throw new Error(`payment_requests flip paid: ${upErr.message}`);

  // 2. Insert payments row
  const payerName = pr.payer_name ?? charge?.billing_details?.name ?? null;

  const { data: inserted, error: insErr } = await supabase
    .from("payments")
    .insert({
      job_id: pr.job_id,
      invoice_id: pr.invoice_id,
      payment_request_id: pr.id,
      source: "stripe",
      method: methodColumn,
      amount: amountReceived,
      reference_number: pi.id,
      payer_name: payerName,
      status: "received",
      received_date: nowIso.slice(0, 10),
      stripe_payment_intent_id: pi.id,
      stripe_charge_id: charge?.id ?? null,
      stripe_fee_amount: feeAmount,
      net_amount: amountReceived - feeAmount,
      quickbooks_sync_status: "pending",
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (insErr) throw new Error(`payments insert: ${insErr.message}`);
  const paymentId = inserted!.id;

  // 3. Update jobs.has_pending_payment_request — recompute
  const { count } = await supabase
    .from("payment_requests")
    .select("id", { count: "exact", head: true })
    .eq("job_id", pr.job_id)
    .in("status", ["sent", "viewed"]);
  await supabase
    .from("jobs")
    .update({ has_pending_payment_request: (count ?? 0) > 0 })
    .eq("id", pr.job_id);

  // 4. Update invoices.stripe_balance_remaining if linked
  if (pr.invoice_id) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("total_amount")
      .eq("id", pr.invoice_id)
      .maybeSingle<{ total_amount: number }>();
    if (inv) {
      const { data: allPaid } = await supabase
        .from("payments")
        .select("amount, status")
        .eq("invoice_id", pr.invoice_id);
      const paidSum = (allPaid ?? [])
        .filter(
          (p: { amount: number; status: string }) => p.status === "received",
        )
        .reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0);
      await supabase
        .from("invoices")
        .update({ stripe_balance_remaining: Number(inv.total_amount) - paidSum })
        .eq("id", pr.invoice_id);
    }
  }

  // 5. Audit log
  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "paid",
    metadata: {
      payment_intent_id: pi.id,
      charge_id: charge?.id ?? null,
      amount_received: amountReceived,
      stripe_fee: feeAmount,
      net_amount: amountReceived - feeAmount,
      amount_mismatch: amountMismatch
        ? { expected, actual: amountReceived }
        : undefined,
    },
  });

  // 6. Build merge extras for emails + receipt
  const { data: jobMeta } = await supabase
    .from("jobs")
    .select("job_number")
    .eq("id", pr.job_id)
    .maybeSingle<{ job_number: string | null }>();
  const extras: PaymentMergeExtras = {
    paid_at: nowIso,
    payer_name: payerName,
    payer_email: pr.payer_email,
    payment_method_type: paymentMethodType,
    card_last4: charge?.payment_method_details?.card?.last4 ?? null,
    card_brand: charge?.payment_method_details?.card?.brand ?? null,
    bank_name:
      charge?.payment_method_details?.us_bank_account?.bank_name ?? null,
    transaction_id: pi.id,
    stripe_receipt_url: charge?.receipt_url ?? null,
    stripe_fee_amount: feeAmount,
    net_amount: amountReceived - feeAmount,
    job_link: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/jobs/${pr.job_id}`,
  };

  // 7. Side effects — each wrapped so one failure doesn't cascade
  await sendPaymentReceiptEmail({
    paymentRequestId: pr.id,
    extras,
  }).catch((e) => {
    console.error(
      `[stripe/webhook] receipt email failed: ${e instanceof Error ? e.message : e}`,
    );
  });
  await sendPaymentInternalNotification({
    paymentRequestId: pr.id,
    kind: "payment_received",
    extras,
  }).catch((e) => {
    console.error(
      `[stripe/webhook] internal notification email failed: ${e instanceof Error ? e.message : e}`,
    );
  });
  await writeNotification({
    type: "payment_received",
    title: `Payment received: ${formatUsdInline(amountReceived)} for job ${jobMeta?.job_number ?? "—"}`,
    body: `${payerName ?? "Customer"} paid ${formatUsdInline(amountReceived)} for ${pr.title}.`,
    href: `/jobs/${pr.job_id}`,
    jobId: pr.job_id,
    metadata: { payment_request_id: pr.id, payment_id: paymentId },
  }).catch((e) => {
    console.error(
      `[stripe/webhook] in-app notification failed: ${e instanceof Error ? e.message : e}`,
    );
  });

  // 8. QB sync — inline, failures recorded on payment row (not fatal)
  await syncPaymentToQb(paymentId).catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("payments")
      .update({
        quickbooks_sync_status: "failed",
        quickbooks_sync_error: msg,
        quickbooks_sync_attempted_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    await supabase
      .from("payment_requests")
      .update({
        quickbooks_sync_status: "failed",
        quickbooks_sync_error: msg,
        quickbooks_sync_attempted_at: new Date().toISOString(),
      })
      .eq("id", pr.id);
    await writeNotification({
      type: "qb_sync_failed",
      title: `QuickBooks sync failed for job ${jobMeta?.job_number ?? "—"}`,
      body: msg,
      href: `/jobs/${pr.job_id}`,
      jobId: pr.job_id,
      priority: "high",
      metadata: { payment_id: paymentId },
    }).catch(() => undefined);
  });

  // 9. If the amount Stripe captured differs materially from what we
  // expected (>$1, skip penny rounding noise), fire a high-priority
  // notification so the operator can reconcile before month-end.
  if (amountMismatch && Math.abs(amountReceived - expected) > 1.0) {
    await writeNotification({
      type: "payment_received",
      priority: "high",
      title: `Amount mismatch on job ${jobMeta?.job_number ?? "—"}: expected ${formatUsdInline(expected)}, received ${formatUsdInline(amountReceived)}`,
      body: `Payment request ${pr.id.slice(0, 8)} charged ${formatUsdInline(amountReceived)} vs. ${formatUsdInline(expected)} expected. Review before reconciling to QB.`,
      href: `/jobs/${pr.job_id}`,
      jobId: pr.job_id,
      metadata: {
        payment_request_id: pr.id,
        payment_id: paymentId,
        expected,
        actual: amountReceived,
      },
    }).catch(() => undefined);
  }

  return { paymentRequestId };
}

function formatUsdInline(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}
