import { createServiceClient } from "@/lib/supabase-api";
import type { NotificationRow } from "@/lib/payments/types";

export type NotificationType = NotificationRow["type"];

export interface WriteNotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  priority?: "normal" | "high";
  jobId?: string | null;
  metadata?: Record<string, unknown>;
  // If provided, notify only this user. Default: fan out to all active admins.
  userId?: string | null;
}

export async function writeNotification(
  input: WriteNotificationInput,
): Promise<void> {
  const supabase = createServiceClient();

  const row = {
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
    priority: input.priority ?? "normal",
    job_id: input.jobId ?? null,
    metadata: input.metadata ?? {},
  };

  if (input.userId) {
    const { error } = await supabase
      .from("notifications")
      .insert({ ...row, user_id: input.userId });
    if (error) throw new Error(`notifications insert: ${error.message}`);
    return;
  }

  // Fan out: one row per active admin.
  const { data: admins, error: adminsErr } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true);
  if (adminsErr) throw new Error(`user_profiles load: ${adminsErr.message}`);
  if (!admins || admins.length === 0) return;

  const rows = admins.map((a: { id: string }) => ({ ...row, user_id: a.id }));
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) throw new Error(`notifications bulk insert: ${error.message}`);
}
