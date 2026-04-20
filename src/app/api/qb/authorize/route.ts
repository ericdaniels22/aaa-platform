import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createOAuthClient, QB_SCOPES } from "@/lib/qb/oauth";

// GET /api/qb/authorize — starts the OAuth flow. Gated behind admin +
// manage_accounting. Generates a CSRF state token, stores it in a short
// (10-min) httpOnly cookie, and redirects to Intuit's consent page.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const state = randomBytes(24).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("qb_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const oauth = createOAuthClient();
  const authUrl = oauth.authorizeUri({ scope: QB_SCOPES, state });
  return NextResponse.redirect(authUrl);
}
