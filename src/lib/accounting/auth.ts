// src/lib/accounting/auth.ts
// Permission gate for /api/accounting/* routes. Admin role OR
// user_organization_permissions.view_accounting.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function requireViewAccounting(): Promise<AuthResult> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };

  const orgId = getActiveOrganizationId();
  const { data: membership } = await supabase
    .from("user_organizations")
    .select("id, role")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle<{ id: string; role: string }>();
  if (!membership) return { ok: false, response: NextResponse.json({ error: "Profile not found" }, { status: 403 }) };

  if (membership.role === "admin") return { ok: true, userId: user.id };

  const { data: perm } = await supabase.from("user_organization_permissions")
    .select("granted")
    .eq("user_organization_id", membership.id)
    .eq("permission_key", "view_accounting")
    .maybeSingle();
  if (perm?.granted) return { ok: true, userId: user.id };

  return { ok: false, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}
