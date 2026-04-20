import { NextResponse, type NextRequest } from "next/server";
import { signOAuthState } from "@/lib/stripe-oauth";
import { requirePermission } from "@/lib/permissions-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(_req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "access_settings");
  if (!gate.ok) return gate.response;

  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId) {
    return NextResponse.json({ error: "STRIPE_CONNECT_CLIENT_ID not set" }, { status: 500 });
  }
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL not set" }, { status: 500 });
  }

  const state = signOAuthState(gate.userId);
  const redirectUri = `${appUrl}/api/stripe/connect/callback`;
  const oauthUrl = new URL("https://connect.stripe.com/oauth/authorize");
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("client_id", clientId);
  oauthUrl.searchParams.set("scope", "read_write");
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("state", state);
  oauthUrl.searchParams.set("stripe_user[business_type]", "company");

  return NextResponse.redirect(oauthUrl.toString(), { status: 303 });
}
