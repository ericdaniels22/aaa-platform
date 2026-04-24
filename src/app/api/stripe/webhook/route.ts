import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";
import {
  verifyWebhook,
  WebhookSecretMissingError,
  WebhookSignatureInvalidError,
} from "@/lib/stripe/webhook/verify";
import {
  claimEvent,
  markProcessed,
  releaseEvent,
} from "@/lib/stripe/webhook/idempotency";
import { handleCheckoutSessionCompleted } from "@/lib/stripe/webhook/handlers/checkout-session-completed";
import { handlePaymentIntentSucceeded } from "@/lib/stripe/webhook/handlers/payment-intent-succeeded";
import { handlePaymentIntentFailed } from "@/lib/stripe/webhook/handlers/payment-intent-failed";
import { handleChargeRefunded } from "@/lib/stripe/webhook/handlers/charge-refunded";
import { handleChargeDisputeCreated, handleChargeDisputeClosed } from "@/lib/stripe/webhook/handlers/charge-dispute";

// Webhook handlers need the raw request body for signature verification.
// Force nodejs runtime + disable response caching.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HandlerResult = { paymentRequestId: string | null };

type Handler = (event: Stripe.Event) => Promise<HandlerResult>;

const HANDLERS: Record<string, Handler> = {
  // Tasks 12-19 replace these stubs with real implementations. Until then,
  // anything not explicitly listed returns null and is marked processed.
  "checkout.session.completed": handleCheckoutSessionCompleted,
  "payment_intent.succeeded": handlePaymentIntentSucceeded,
  "payment_intent.payment_failed": handlePaymentIntentFailed,
  "charge.refunded": handleChargeRefunded,
  "charge.dispute.created": handleChargeDisputeCreated,
  "charge.dispute.closed": handleChargeDisputeClosed,
};

// Resolve the org id for a Stripe event. Reads the metadata written on the
// event's object by our Checkout Session creation code. All events issued
// after 18a carry this metadata; earlier events do not. Returns null if
// the metadata is missing — the caller logs and drops the event rather
// than silently routing it to a hardcoded tenant.
function resolveOrgFromStripeEvent(event: Stripe.Event): string | null {
  const obj = event.data?.object as { metadata?: Record<string, string> } | undefined;
  const metaOrg = obj?.metadata?.organization_id;
  return metaOrg && typeof metaOrg === "string" && metaOrg.length > 0 ? metaOrg : null;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = await verifyWebhook(rawBody, signature);
  } catch (e) {
    if (e instanceof WebhookSecretMissingError) {
      return NextResponse.json({ error: "webhook_secret_not_configured" }, { status: 503 });
    }
    if (e instanceof WebhookSignatureInvalidError) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
    }
    console.error(
      `[stripe/webhook] verify failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  try {
    const supabase = createServiceClient();
    const orgId = resolveOrgFromStripeEvent(event);
    if (!orgId) {
      // Event pre-dates 18a or was issued by code that didn't set
      // metadata.organization_id. We log and acknowledge so Stripe stops
      // retrying, but do not route it to a tenant.
      console.error(
        `[stripe/webhook] dropping event with no org metadata: ${event.type} ${event.id}`,
      );
      return NextResponse.json({ ok: true, dropped: "no_org_metadata" });
    }

    const claim = await claimEvent(supabase, event, orgId);
    if (claim.status === "duplicate") {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const handler = HANDLERS[event.type];
    if (!handler) {
      // Unknown event type — we still stored it (good for audit). Mark processed
      // so Stripe doesn't retry. Nothing to do.
      await markProcessed(supabase, claim.rowId, null);
      return NextResponse.json({ ok: true, handled: false });
    }

    try {
      const result = await handler(event);
      await markProcessed(supabase, claim.rowId, result.paymentRequestId);
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[stripe/webhook] handler failed for ${event.type} ${event.id}: ${msg}`,
      );
      await releaseEvent(supabase, claim.rowId, e);
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  } catch (e) {
    // Catches failures of claimEvent / markProcessed themselves — ensures
    // we always respond with JSON, not Next's HTML 500 page.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[stripe/webhook] dispatch failed for ${event.type} ${event.id}: ${msg}`,
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
