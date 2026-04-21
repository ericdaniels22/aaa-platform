import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export type ClaimResult =
  | { status: "claimed"; rowId: string }
  | { status: "duplicate" };

// Attempts to claim the event for processing by inserting into stripe_events.
// Returns "claimed" on success, "duplicate" if the row already exists.
// organizationId scopes the event to a tenant — the caller resolves it
// from event.data.object.metadata.organization_id (with an 18a fallback
// to the AAA helper for events issued before the cutover).
export async function claimEvent(
  supabase: SupabaseClient,
  event: Stripe.Event,
  organizationId: string,
): Promise<ClaimResult> {
  const { data, error } = await supabase
    .from("stripe_events")
    .insert({
      organization_id: organizationId,
      stripe_event_id: event.id,
      event_type: event.type,
      livemode: event.livemode ?? null,
      payload: event as unknown as Record<string, unknown>,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) {
    // Supabase PostgREST maps UNIQUE violation to code 23505 / details "duplicate key".
    const msg = error.message.toLowerCase();
    if (
      error.code === "23505" ||
      msg.includes("duplicate key") ||
      msg.includes("violates unique")
    ) {
      return { status: "duplicate" };
    }
    throw new Error(`stripe_events insert failed: ${error.message}`);
  }
  if (!data) throw new Error("stripe_events insert returned no row");
  return { status: "claimed", rowId: data.id };
}

export async function markProcessed(
  supabase: SupabaseClient,
  rowId: string,
  paymentRequestId: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    processed_at: new Date().toISOString(),
  };
  if (paymentRequestId) patch.payment_request_id = paymentRequestId;
  const { error } = await supabase
    .from("stripe_events")
    .update(patch)
    .eq("id", rowId);
  if (error) throw new Error(`stripe_events mark-processed failed: ${error.message}`);
}

// On handler exception: delete the row so Stripe's retry re-claims cleanly.
// Returns nothing — best-effort. If this delete itself fails, the caller
// should log and still return 500; a manual DB cleanup unblocks retries.
export async function releaseEvent(
  supabase: SupabaseClient,
  rowId: string,
  err: unknown,
): Promise<void> {
  const errText = err instanceof Error ? err.message : String(err);
  // First, try to record the error — helpful for post-mortem.
  await supabase
    .from("stripe_events")
    .update({ processing_error: errText })
    .eq("id", rowId)
    .then(() => undefined, () => undefined);
  // Then delete so the next Stripe retry can re-insert.
  await supabase
    .from("stripe_events")
    .delete()
    .eq("id", rowId)
    .then(() => undefined, () => undefined);
}
