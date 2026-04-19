// src/lib/accounting/auth.ts
// Permission gate for /api/accounting/* routes. Matches the pattern in
// src/app/api/expenses/route.ts (admin role OR user_permissions.view_accounting).

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function requireViewAccounting(): Promise<AuthResult> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };

  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile) return { ok: false, response: NextResponse.json({ error: "Profile not found" }, { status: 403 }) };

  if (profile.role === "admin") return { ok: true, userId: user.id };

  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "view_accounting").maybeSingle();
  if (perm?.granted) return { ok: true, userId: user.id };

  return { ok: false, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}
