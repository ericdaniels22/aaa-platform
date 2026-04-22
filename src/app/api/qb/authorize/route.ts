import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createOAuthClient, QB_SCOPES } from "@/lib/qb/oauth";
import { requireAdmin } from "@/lib/qb/auth";

// GET /api/qb/authorize — starts the OAuth flow. Gated behind admin +
// manage_accounting. Generates a CSRF state token, stores it in a short
// (10-min) httpOnly cookie, and redirects to Intuit's consent page.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const guard = await requireAdmin(supabase);
  if (!guard.ok) return guard.response;

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
