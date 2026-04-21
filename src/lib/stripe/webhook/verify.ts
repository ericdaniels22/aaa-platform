import Stripe from "stripe";
import { decrypt } from "@/lib/encryption";
import { createServiceClient } from "@/lib/supabase-api";

export class WebhookSecretMissingError extends Error {
  constructor() {
    super(
      "Webhook signing secret is not configured. Paste it in Settings → Stripe Payments → Webhook Configuration.",
    );
    this.name = "WebhookSecretMissingError";
  }
}

export class WebhookSignatureInvalidError extends Error {
  constructor(detail: string) {
    super(`Stripe webhook signature verification failed: ${detail}`);
    this.name = "WebhookSignatureInvalidError";
  }
}

async function loadWebhookSecret(): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("stripe_connection")
    .select("webhook_signing_secret_encrypted")
    .limit(1)
    .maybeSingle<{ webhook_signing_secret_encrypted: string | null }>();
  if (error) throw new Error(`stripe_connection load failed: ${error.message}`);
  if (!data || !data.webhook_signing_secret_encrypted)
    throw new WebhookSecretMissingError();
  try {
    return decrypt(data.webhook_signing_secret_encrypted);
  } catch (e) {
    throw new Error(
      `Failed to decrypt webhook signing secret: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// Verifies the signature on an incoming Stripe webhook request. Uses a
// separate Stripe instance (not the tenant getStripeClient) because this
// path runs before we know the event type or account. Any Stripe instance
// can call .webhooks.constructEvent — no API calls are made.
const VERIFIER = new Stripe(process.env.STRIPE_CONNECT_CLIENT_SECRET || "sk_dummy", {
  apiVersion: "2026-03-25.dahlia",
});

export async function verifyWebhook(
  rawBody: string,
  signature: string | null,
): Promise<Stripe.Event> {
  if (!signature) {
    throw new WebhookSignatureInvalidError("missing stripe-signature header");
  }
  const secret = await loadWebhookSecret();
  try {
    return VERIFIER.webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    throw new WebhookSignatureInvalidError(
      e instanceof Error ? e.message : String(e),
    );
  }
}
