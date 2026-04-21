import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";

interface HandlerResult {
  paymentRequestId: string | null;
}

export async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<HandlerResult> {
  const session = event.data.object as Stripe.Checkout.Session;
  const paymentRequestId =
    (session.metadata as Record<string, string> | null)?.payment_request_id ?? null;
  if (!paymentRequestId) {
    console.warn(
      `[webhook] checkout.session.completed ${session.id} has no metadata.payment_request_id — skipping`,
    );
    return { paymentRequestId: null };
  }

  const supabase = createServiceClient();

  const payerEmail =
    session.customer_details?.email ?? session.customer_email ?? null;
  const payerName = session.customer_details?.name ?? null;
  const paymentMethodType =
    (session.payment_method_types?.[0] as string | undefined) === "us_bank_account"
      ? "us_bank_account"
      : "card";
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const patch: Record<string, unknown> = {
    payment_method_type: paymentMethodType,
  };
  if (payerEmail) patch.payer_email = payerEmail;
  if (payerName) patch.payer_name = payerName;
  if (paymentIntentId) patch.stripe_payment_intent_id = paymentIntentId;

  const { error } = await supabase
    .from("payment_requests")
    .update(patch)
    .eq("id", paymentRequestId);
  if (error) throw new Error(`payment_requests update: ${error.message}`);

  return { paymentRequestId };
}
