import { loadStripeConnection } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase-api";
import StripeSettingsClient from "./stripe-settings-client";

export const dynamic = "force-dynamic";

export default async function StripeSettingsPage() {
  const connection = await loadStripeConnection();

  const webhookConfigured = Boolean(connection?.webhook_signing_secret_encrypted);

  // Most recent stripe_events row timestamp (for "last event received" indicator).
  let lastEventAt: string | null = null;
  if (webhookConfigured) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("stripe_events")
      .select("received_at")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ received_at: string }>();
    lastEventAt = data?.received_at ?? null;
  }

  return (
    <StripeSettingsClient
      initialConnection={connection}
      webhookConfigured={webhookConfigured}
      lastEventAt={lastEventAt}
    />
  );
}
