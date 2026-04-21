import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";
import { writePaymentEvent } from "@/lib/payments/activity";
import { sendPaymentInternalNotification } from "@/lib/payment-emails";
import { writeNotification } from "@/lib/notifications/write";
import type { PaymentRow } from "@/lib/payments/types";

type DisputeStatus =
  | "warning_needs_response"
  | "warning_under_review"
  | "warning_closed"
  | "needs_response"
  | "under_review"
  | "won"
  | "lost";

function normalizeStatus(raw: string): DisputeStatus | null {
  const allowed: DisputeStatus[] = [
    "warning_needs_response",
    "warning_under_review",
    "warning_closed",
    "needs_response",
    "under_review",
    "won",
    "lost",
  ];
  return allowed.includes(raw as DisputeStatus) ? (raw as DisputeStatus) : null;
}

export async function handleChargeDisputeCreated(
  event: Stripe.Event,
): Promise<{ paymentRequestId: string | null }> {
  const dispute = event.data.object as Stripe.Dispute;
  const chargeId =
    typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;

  const supabase = createServiceClient();

  const { data: payment } = await supabase
    .from("payments")
    .select("id, job_id, payment_request_id")
    .eq("stripe_charge_id", chargeId)
    .maybeSingle<Pick<PaymentRow, "id" | "job_id" | "payment_request_id">>();

  const status = normalizeStatus(dispute.status);
  const dueBy = dispute.evidence_details?.due_by
    ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
    : null;

  const { error: upErr } = await supabase
    .from("stripe_disputes")
    .upsert(
      {
        payment_id: payment?.id ?? null,
        payment_request_id: payment?.payment_request_id ?? null,
        stripe_dispute_id: dispute.id,
        amount: dispute.amount / 100,
        reason: dispute.reason,
        status,
        evidence_due_by: dueBy,
        opened_at: new Date(
          (dispute.created ?? Date.now() / 1000) * 1000,
        ).toISOString(),
      },
      { onConflict: "stripe_dispute_id" },
    );
  if (upErr) throw new Error(`stripe_disputes upsert: ${upErr.message}`);

  if (payment?.payment_request_id) {
    await writePaymentEvent(supabase, {
      paymentRequestId: payment.payment_request_id,
      eventType: "dispute_opened",
      metadata: {
        stripe_dispute_id: dispute.id,
        amount: dispute.amount / 100,
        reason: dispute.reason,
        status,
      },
    });

    const { data: jobMeta } = await supabase
      .from("jobs")
      .select("job_number")
      .eq("id", payment.job_id)
      .maybeSingle<{ job_number: string | null }>();

    await sendPaymentInternalNotification({
      paymentRequestId: payment.payment_request_id,
      kind: "dispute_opened",
      subjectPrefix: "DISPUTE OPENED — ",
      extras: {
        failure_reason: dispute.reason,
        job_link: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/jobs/${payment.job_id}`,
      },
    }).catch((e) =>
      console.error(
        `[stripe/webhook] internal dispute email: ${e instanceof Error ? e.message : e}`,
      ),
    );

    await writeNotification({
      type: "dispute_opened",
      title: `Dispute opened: $${(dispute.amount / 100).toFixed(2)} — job ${jobMeta?.job_number ?? "—"}`,
      body: `Reason: ${dispute.reason}. Evidence due: ${dueBy ? new Date(dueBy).toLocaleDateString() : "—"}.`,
      href: `/jobs/${payment.job_id}`,
      priority: "high",
      jobId: payment.job_id,
      metadata: { stripe_dispute_id: dispute.id },
    }).catch(() => undefined);
  }

  return { paymentRequestId: payment?.payment_request_id ?? null };
}

export async function handleChargeDisputeClosed(
  event: Stripe.Event,
): Promise<{ paymentRequestId: string | null }> {
  const dispute = event.data.object as Stripe.Dispute;
  const supabase = createServiceClient();

  const status = normalizeStatus(dispute.status);

  const { data: existing } = await supabase
    .from("stripe_disputes")
    .select("payment_request_id")
    .eq("stripe_dispute_id", dispute.id)
    .maybeSingle<{ payment_request_id: string | null }>();

  await supabase
    .from("stripe_disputes")
    .update({ status, closed_at: new Date().toISOString() })
    .eq("stripe_dispute_id", dispute.id);

  if (existing?.payment_request_id) {
    await writePaymentEvent(supabase, {
      paymentRequestId: existing.payment_request_id,
      eventType: "dispute_closed",
      metadata: {
        stripe_dispute_id: dispute.id,
        final_status: status,
      },
    });
  }

  return { paymentRequestId: existing?.payment_request_id ?? null };
}
