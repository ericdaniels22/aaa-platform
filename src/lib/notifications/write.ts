export interface WriteNotificationInput {
  type:
    | "payment_received"
    | "payment_failed"
    | "refund_issued"
    | "dispute_opened"
    | "qb_sync_failed";
  title: string;
  body?: string;
  href?: string;
  priority?: "normal" | "high";
  userProfileId?: string | null;
  metadata?: Record<string, unknown>;
}

// Stub: Task 14 replaces with the real implementation. Always returns null
// so Option B (defer) also works — nothing surfaces but the webhook flow
// continues uninterrupted.
export async function writeNotification(
  _input: WriteNotificationInput,
): Promise<null> {
  return null;
}
