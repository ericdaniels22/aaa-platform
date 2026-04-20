// Shared gate used by every /api/qb/* route (except the cron endpoint,
// which authenticates via CRON_SECRET). Returns the authorized user id or
// an error response ready to be returned straight from the route handler.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RequireAdminResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function requireAdmin(
  supabase: SupabaseClient,
): Promise<RequireAdminResult> {
  const { data: { user } } = await supabase.auth.getUser();
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
  if (profile?.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "admin only" }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}
