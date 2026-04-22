import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
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
  // Org scope for the notification row(s). Defaults to the active org helper.
  organizationId?: string;
}

export async function writeNotification(
  input: WriteNotificationInput,
): Promise<void> {
  const supabase = createServiceClient();
  const orgId = input.organizationId ?? getActiveOrganizationId();

  const row = {
    organization_id: orgId,
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

  // Fan out: one row per active admin of this org. Role lives on
  // user_organizations; joined through user_profiles for the is_active filter.
  const { data: admins, error: adminsErr } = await supabase
    .from("user_organizations")
    .select("user_id, user_profiles:user_id(is_active)")
    .eq("organization_id", orgId)
    .eq("role", "admin");
  if (adminsErr) throw new Error(`admin lookup: ${adminsErr.message}`);

  const activeAdminIds = (admins ?? [])
    .filter((a) => {
      const profile = Array.isArray(a.user_profiles) ? a.user_profiles[0] : a.user_profiles;
      return profile?.is_active === true;
    })
    .map((a) => a.user_id);

  if (activeAdminIds.length === 0) return;

  const rows = activeAdminIds.map((userId: string) => ({ ...row, user_id: userId }));
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) throw new Error(`notifications bulk insert: ${error.message}`);
}
