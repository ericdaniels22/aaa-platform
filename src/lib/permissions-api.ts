// Shared route gate that authorizes by permission key. Admins always pass.
// Mirrors the shape of requireAdmin() in src/lib/qb/auth.ts so the call site
// looks identical: `if (!gate.ok) return gate.response;`

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RequirePermissionResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function requirePermission(
  supabase: SupabaseClient,
  key: string,
): Promise<RequirePermissionResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "not authenticated" }, { status: 401 }),
    };
  }
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  if (profile?.role === "admin") {
    return { ok: true, userId: user.id };
  }
  const { data: perm } = await supabase
    .from("user_permissions")
    .select("granted")
    .eq("user_id", user.id)
    .eq("permission_key", key)
    .maybeSingle<{ granted: boolean }>();
  if (perm?.granted === true) {
    return { ok: true, userId: user.id };
  }
  return {
    ok: false,
    response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
  };
}
