// 17c Task 18 — charge.refunded webhook handler.
//
// Reconciles refunds from both paths:
//   1. UI-initiated (Task 17) — a refunds row already exists in "pending"
//      with stripe_refund_id, refunded_by=admin, notify_customer flag set.
//   2. Stripe Dashboard-initiated — no refunds row; we create one with
//      refunded_by=null and a "Initiated from Stripe dashboard" reason.
//
// Idempotency: once the refunds row is "succeeded" we short-circuit.
// Partial-vs-full is determined by comparing charge.amount_refunded (running
// total across all refunds on the charge) against charge.amount.

import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";
import { getStripeClient } from "@/lib/stripe";
import { getValidAccessToken } from "@/lib/qb/tokens";
import { writePaymentEvent } from "@/lib/payments/activity";
import {
  sendRefundConfirmationEmail,
  sendPaymentInternalNotification,
} from "@/lib/payment-emails";
import { writeNotification } from "@/lib/notifications/write";
import { postRefundToQb } from "@/lib/qb/sync/refunds";
import type {
  PaymentRequestRow,
  PaymentRow,
  RefundRow,
} from "@/lib/payments/types";

export async function handleChargeRefunded(
  event: Stripe.Event,
): Promise<{ paymentRequestId: string | null }> {
  const charge = event.data.object as Stripe.Charge;
  const chargeId = charge.id;

  const supabase = createServiceClient();

  // 1. Find the payment by stripe_charge_id. organization_id comes along
  //    so downstream inserts (refunds, notifications, activity) can stamp
  //    the correct tenant.
  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .select(
      "id, organization_id, job_id, invoice_id, amount, payment_request_id, stripe_charge_id, received_date",
    )
    .eq("stripe_charge_id", chargeId)
    .maybeSingle<
      Pick<
        PaymentRow,
        | "id"
        | "organization_id"
        | "job_id"
        | "invoice_id"
        | "amount"
        | "payment_request_id"
        | "stripe_charge_id"
        | "received_date"
      >
    >();
  if (payErr || !payment) {
    console.warn(
      `[stripe/webhook] charge.refunded — no payments row for charge ${chargeId}`,
    );
    return { paymentRequestId: null };
  }

  // 2. Find the most recent Stripe refund object on this charge. Stripe
  //    fires charge.refunded once per refund, but the event payload itself
  //    doesn't include which refund object triggered the fire, so we
  //    fetch the list and take the most recent.
  const { client: stripe } = await getStripeClient(payment.organization_id);
  const refundList = await stripe.refunds.list({ charge: chargeId, limit: 10 });
  if (!refundList.data.length) {
    console.warn(
      `[stripe/webhook] charge.refunded — Stripe has no refund objects for charge ${chargeId}`,
    );
    return { paymentRequestId: payment.payment_request_id };
  }

  const newestRefund = refundList.data[0]!;

  // 3. Find or create the refunds row.
  let { data: refundRow } = await supabase
    .from("refunds")
    .select("*")
    .eq("stripe_refund_id", newestRefund.id)
    .maybeSingle<RefundRow>();

  if (!refundRow) {
    // Dashboard-initiated — no row yet. Create one with refunded_by=null.
    const { data: created, error: crErr } = await supabase
      .from("refunds")
      .insert({
        organization_id: payment.organization_id,
        payment_id: payment.id,
        payment_request_id: payment.payment_request_id,
        amount: newestRefund.amount / 100,
        reason: "Initiated from Stripe dashboard",
        include_reason_in_customer_email: false,
        notify_customer: true,
        stripe_refund_id: newestRefund.id,
        status: "pending",
        refunded_by: null,
      })
      .select("*")
      .maybeSingle<RefundRow>();
    if (crErr || !created) {
      throw new Error(
        `refunds insert (dashboard-initiated): ${crErr?.message ?? ""}`,
      );
    }
    refundRow = created;
  }

  // Idempotency — already reconciled.
  if (refundRow.status === "succeeded") {
    return { paymentRequestId: payment.payment_request_id };
  }

  // 4. Flip refund row to succeeded.
  const nowIso = new Date().toISOString();
  await supabase
    .from("refunds")
    .update({ status: "succeeded", refunded_at: nowIso })
    .eq("id", refundRow.id);

  // 5. Full vs partial.
  const totalRefunded = charge.amount_refunded;
  const chargeAmount = charge.amount;
  const isFull = totalRefunded >= chargeAmount;

  // 6. Flip payment_requests.status (if linked).
  if (payment.payment_request_id) {
    await supabase
      .from("payment_requests")
      .update({ status: isFull ? "refunded" : "partially_refunded" })
      .eq("id", payment.payment_request_id);
  }

  // 7. Flip payments.status on full refunds.
  if (isFull) {
    await supabase
      .from("payments")
      .update({ status: "refunded" })
      .eq("id", payment.id);
  }

  // 8. Audit trail.
  if (payment.payment_request_id) {
    await writePaymentEvent(supabase, {
      paymentRequestId: payment.payment_request_id,
      eventType: isFull ? "refunded" : "partially_refunded",
      metadata: {
        refund_id: refundRow.id,
        stripe_refund_id: newestRefund.id,
        amount: refundRow.amount,
      },
    });
  }

  // 9. Gather extras for email merge fields + notifications.
  const prLookup = payment.payment_request_id
    ? await supabase
        .from("payment_requests")
        .select("*")
        .eq("id", payment.payment_request_id)
        .maybeSingle<PaymentRequestRow>()
    : { data: null };
  const pr = prLookup.data;

  const { data: jobMeta } = await supabase
    .from("jobs")
    .select("job_number")
    .eq("id", payment.job_id)
    .maybeSingle<{ job_number: string | null }>();

  let refundedByName: string | null;
  if (refundRow.refunded_by) {
    const { data: userRow } = await supabase
      .from("user_profiles")
      .select("first_name, last_name")
      .eq("id", refundRow.refunded_by)
      .maybeSingle<{ first_name: string | null; last_name: string | null }>();
    refundedByName =
      [userRow?.first_name, userRow?.last_name].filter(Boolean).join(" ") ||
      null;
  } else {
    refundedByName = "Stripe Dashboard";
  }

  const extras = {
    refund_amount: refundRow.amount,
    refund_reason: refundRow.include_reason_in_customer_email
      ? refundRow.reason
      : "",
    refunded_at: nowIso,
    refunded_by_name: refundedByName,
    payer_name: pr?.payer_name ?? null,
    payer_email: pr?.payer_email ?? null,
    job_link: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/jobs/${payment.job_id}`,
  };

  // 10. Customer refund confirmation email.
  if (refundRow.notify_customer && payment.payment_request_id) {
    await sendRefundConfirmationEmail({
      paymentRequestId: payment.payment_request_id,
      extras,
    }).catch((e) =>
      console.error(
        `[stripe/webhook] refund email: ${e instanceof Error ? e.message : e}`,
      ),
    );
  }

  // 11. Internal notification email — sees the reason regardless of the
  //     include_reason_in_customer_email flag.
  if (payment.payment_request_id) {
    await sendPaymentInternalNotification({
      paymentRequestId: payment.payment_request_id,
      kind: "refund_issued",
      extras: { ...extras, refund_reason: refundRow.reason },
    }).catch((e) =>
      console.error(
        `[stripe/webhook] internal refund email: ${e instanceof Error ? e.message : e}`,
      ),
    );
  }

  // 12. In-app notification (fans out to all admins of the payment's org).
  await writeNotification({
    type: "refund_issued",
    title: `Refund issued: $${refundRow.amount.toFixed(2)} — job ${jobMeta?.job_number ?? "—"}`,
    body: `${refundedByName} refunded $${refundRow.amount.toFixed(2)} for ${pr?.title ?? ""}.`,
    href: `/jobs/${payment.job_id}`,
    jobId: payment.job_id,
    organizationId: payment.organization_id,
    metadata: {
      payment_id: payment.id,
      refund_id: refundRow.id,
      payment_request_id: payment.payment_request_id,
    },
  }).catch(() => undefined);

  // 13. QB refund push — best-effort; a token-miss or mapping-miss just
  //     leaves the QB side unsynced and logs.
  const token = await getValidAccessToken(supabase);
  if (token) {
    await postRefundToQb(supabase, token, {
      refundId: refundRow.id,
      paymentId: payment.id,
      amount: refundRow.amount,
      paidDate: payment.received_date ?? nowIso.slice(0, 10),
      stripeRefundId: newestRefund.id,
      invoiceId: payment.invoice_id,
      jobId: payment.job_id,
    }).catch((e) =>
      console.error(
        `[stripe/webhook] QB refund push: ${e instanceof Error ? e.message : e}`,
      ),
    );
  }

  return { paymentRequestId: payment.payment_request_id };
}
