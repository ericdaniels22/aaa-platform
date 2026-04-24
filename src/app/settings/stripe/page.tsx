import { loadStripeConnection } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import StripeSettingsClient from "./stripe-settings-client";

export const dynamic = "force-dynamic";

export default async function StripeSettingsPage() {
  const auth = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(auth);
  const connection = orgId ? await loadStripeConnection(orgId) : null;

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
