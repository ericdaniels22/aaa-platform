import type { SupabaseClient } from "@supabase/supabase-js";

// Writes a payment-scoped row to contract_events (schema widened in
// migration-build40: contract_id is nullable so payment events share
// the same audit table per spec Part 5). payment_request_id goes in
// metadata; contract_id + signer_id stay NULL. contract_events is
// bucket-B and requires organization_id post-build45 — the caller must
// derive it from the payment_request row before calling.
export interface PaymentEventArgs {
  paymentRequestId: string;
  eventType:
    | "created"
    | "sent"
    | "email_delivered"
    | "email_opened"
    | "link_viewed"
    | "reminder_sent"
    | "voided"
    | "expired"
    // Added in build41 (Build 17c webhook handlers): contract_events CHECK
    // was widened at the DB level; keep this union aligned.
    | "paid"
    | "payment_failed"
    | "refunded"
    | "partially_refunded"
    | "dispute_opened"
    | "dispute_closed";
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function writePaymentEvent(
  supabase: SupabaseClient,
  args: PaymentEventArgs,
): Promise<void> {
  // Look up the payment_request's org so the audit row is tenant-scoped.
  // If the lookup fails we skip the write rather than violate the NOT NULL
  // constraint; audit is best-effort anyway.
  const { data: pr } = await supabase
    .from("payment_requests")
    .select("organization_id")
    .eq("id", args.paymentRequestId)
    .maybeSingle<{ organization_id: string }>();
  if (!pr) {
    console.error("writePaymentEvent: payment_request not found", args.paymentRequestId);
    return;
  }

  const { error } = await supabase.from("contract_events").insert({
    organization_id: pr.organization_id,
    contract_id: null,
    signer_id: null,
    event_type: args.eventType,
    ip_address: args.ipAddress ?? null,
    user_agent: args.userAgent ?? null,
    metadata: {
      payment_request_id: args.paymentRequestId,
      ...(args.metadata ?? {}),
    },
  });
  if (error) {
    // Audit write failures must not block the main flow.
    // eslint-disable-next-line no-console
    console.error("writePaymentEvent failed:", error);
  }
}
