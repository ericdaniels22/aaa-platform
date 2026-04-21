import { createServiceClient } from "@/lib/supabase-api";
import type { NotificationType } from "./types";

export interface WriteNotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  priority?: "normal" | "high";
  userProfileId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeNotification(
  input: WriteNotificationInput,
): Promise<{ id: string } | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_profile_id: input.userProfileId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      priority: input.priority ?? "normal",
      metadata: input.metadata ?? {},
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`notifications insert: ${error.message}`);
  return data;
}
