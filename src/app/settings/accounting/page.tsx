import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveConnection } from "@/lib/qb/tokens";
import AccountingSettingsClient from "./accounting-settings-client";

// Server-side gate: admin + manage_accounting + access_settings. Fetches
// the current connection (stripped of tokens) so the client side can
// render the right state on first paint without an extra round-trip.
export default async function AccountingSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  const isAdmin = profile?.role === "admin";

  // Permissions check (admin shortcut, then two named perms).
  let canAccess = isAdmin;
  if (!canAccess) {
    const { data: perms } = await supabase
      .from("user_permissions")
      .select("permission_key, granted")
      .eq("user_id", user.id)
      .in("permission_key", ["access_settings", "manage_accounting"]);
    const ok = new Set((perms ?? []).filter((p) => p.granted).map((p) => p.permission_key));
    canAccess = ok.has("access_settings") && ok.has("manage_accounting");
  }
  if (!canAccess) redirect("/settings/company");

  const service = createServiceClient();
  const conn = await getActiveConnection(service);

  return (
    <AccountingSettingsClient
      initialConnection={
        conn
          ? {
              id: conn.id,
              company_name: conn.company_name,
              realm_id: conn.realm_id,
              sync_start_date: conn.sync_start_date,
              setup_completed_at: conn.setup_completed_at,
              dry_run_mode: conn.dry_run_mode,
              is_active: conn.is_active,
              last_sync_at: conn.last_sync_at,
              refresh_token_expires_at: conn.refresh_token_expires_at,
            }
          : null
      }
    />
  );
}
