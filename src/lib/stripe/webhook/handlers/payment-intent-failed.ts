import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";
import { writePaymentEvent } from "@/lib/payments/activity";
import { sendPaymentInternalNotification } from "@/lib/payment-emails";
import { writeNotification } from "@/lib/notifications/write";
import type { PaymentRequestRow } from "@/lib/payments/types";

export async function handlePaymentIntentFailed(
  event: Stripe.Event,
): Promise<{ paymentRequestId: string | null }> {
  const pi = event.data.object as Stripe.PaymentIntent;
  const paymentRequestId =
    (pi.metadata as Record<string, string> | null)?.payment_request_id ?? null;
  if (!paymentRequestId) {
    console.warn(
      `[stripe/webhook] payment_intent.payment_failed ${pi.id} has no metadata.payment_request_id — skipping`,
    );
    return { paymentRequestId: null };
  }

  const supabase = createServiceClient();
  const { data: pr } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", paymentRequestId)
    .maybeSingle<PaymentRequestRow>();
  if (!pr) return { paymentRequestId };

  // Idempotency: if already failed, skip side effects.
  if (pr.status === "failed") return { paymentRequestId };

  const failureReason =
    pi.last_payment_error?.message ??
    pi.last_payment_error?.code ??
    "unknown";

  await supabase
    .from("payment_requests")
    .update({ status: "failed" })
    .eq("id", paymentRequestId)
    .eq("status", pr.status);

  await writePaymentEvent(supabase, {
    paymentRequestId,
    eventType: "payment_failed",
    metadata: {
      payment_intent_id: pi.id,
      failure_code: pi.last_payment_error?.code,
      failure_reason: failureReason,
      decline_code: pi.last_payment_error?.decline_code,
    },
  });

  const { data: jobMeta } = await supabase
    .from("jobs")
    .select("job_number")
    .eq("id", pr.job_id)
    .maybeSingle<{ job_number: string | null }>();

  const extras = {
    payer_name: pr.payer_name,
    payer_email: pr.payer_email,
    failure_reason: failureReason,
    job_link: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/jobs/${pr.job_id}`,
  };

  await sendPaymentInternalNotification({
    paymentRequestId,
    kind: "payment_failed",
    extras,
  }).catch((e) => {
    console.error(
      `[stripe/webhook] internal failure email: ${e instanceof Error ? e.message : e}`,
    );
  });

  await writeNotification({
    type: "payment_failed",
    title: `Payment failed: ${pr.title} (job ${jobMeta?.job_number ?? "—"})`,
    body: failureReason,
    href: `/jobs/${pr.job_id}`,
    jobId: pr.job_id,
    metadata: { payment_request_id: pr.id },
  }).catch(() => undefined);

  return { paymentRequestId };
}
