import { NextResponse, type NextRequest } from "next/server";
import { verifyOAuthState, InvalidOAuthStateError } from "@/lib/stripe-oauth";
import { createServiceClient } from "@/lib/supabase-api";
import { encrypt } from "@/lib/encryption";

interface StripeOAuthTokenResponse {
  stripe_user_id: string;
  stripe_publishable_key: string;
  access_token: string;
  livemode: boolean;
  scope: string;
  error?: string;
  error_description?: string;
}

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const back = (msg: string) => {
    const dest = new URL(`${appUrl}/settings/stripe`);
    dest.searchParams.set("connect_error", msg);
    return NextResponse.redirect(dest.toString(), { status: 303 });
  };

  if (errorParam) return back(errorParam);
  if (!code || !stateParam) return back("missing_params");

  let payload: ReturnType<typeof verifyOAuthState>;
  try {
    payload = verifyOAuthState(stateParam);
  } catch (e) {
    if (e instanceof InvalidOAuthStateError) return back("invalid_state");
    throw e;
  }

  const platformSecret = process.env.STRIPE_CONNECT_CLIENT_SECRET;
  if (!platformSecret) {
    return back("platform_secret_missing");
  }

  const tokenRes = await fetch("https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_secret: platformSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  const token = (await tokenRes.json()) as StripeOAuthTokenResponse;
  if (!tokenRes.ok || token.error) {
    return back(token.error ?? "token_exchange_failed");
  }

  const supabase = createServiceClient();
  // Single-row pattern: delete existing, insert fresh.
  await supabase
    .from("stripe_connection")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  const { error: insertErr } = await supabase.from("stripe_connection").insert({
    stripe_account_id: token.stripe_user_id,
    publishable_key: token.stripe_publishable_key,
    secret_key_encrypted: encrypt(token.access_token),
    mode: token.livemode ? "live" : "test",
    last_connected_at: new Date().toISOString(),
    connected_by: payload.user_id,
  });
  if (insertErr) return back("db_insert_failed");

  const dest = new URL(`${appUrl}/settings/stripe`);
  dest.searchParams.set("connected", "1");
  return NextResponse.redirect(dest.toString(), { status: 303 });
}
