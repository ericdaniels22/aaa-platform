import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import SyncLogClient from "./sync-log-client";

export default async function SyncLogPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  const isAdmin = profile?.role === "admin";
  let canView = isAdmin;
  if (!canView) {
    const { data: perm } = await supabase
      .from("user_permissions")
      .select("granted")
      .eq("user_id", user.id)
      .eq("permission_key", "view_accounting")
      .maybeSingle<{ granted: boolean }>();
    canView = !!perm?.granted;
  }
  if (!canView) redirect("/");

  return <SyncLogClient />;
}
