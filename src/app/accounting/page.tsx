// src/app/accounting/page.tsx
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import AccountingDashboard from "@/components/accounting/accounting-dashboard";

export default async function AccountingPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("user_organizations")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("organization_id", await getActiveOrganizationId(supabase))
    .maybeSingle<{ id: string; role: string }>();
  const isAdmin = membership?.role === "admin";
  let canView = isAdmin;
  if (!canView && membership) {
    const { data: perm } = await supabase
      .from("user_organization_permissions")
      .select("granted")
      .eq("user_organization_id", membership.id)
      .eq("permission_key", "view_accounting")
      .maybeSingle();
    canView = !!perm?.granted;
  }
  if (!canView) redirect("/");

  return <AccountingDashboard />;
}
