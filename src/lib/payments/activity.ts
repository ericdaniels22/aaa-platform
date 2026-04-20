import type { SupabaseClient } from "@supabase/supabase-js";

// Writes a payment-scoped row to contract_events (schema widened in
// migration-build40: contract_id is nullable so payment events share
// the same audit table per spec Part 5). payment_request_id goes in
// metadata; contract_id + signer_id stay NULL.
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
    | "expired";
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function writePaymentEvent(
  supabase: SupabaseClient,
  args: PaymentEventArgs,
): Promise<void> {
  const { error } = await supabase.from("contract_events").insert({
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
