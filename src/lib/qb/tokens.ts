// Single chokepoint for QB access tokens. Every caller goes through
// getValidAccessToken() — never reads access_token_encrypted directly.
//
// Behaviour:
//   1. Load active qb_connection row.
//   2. If access_token expires in < 5 minutes, refresh it via intuit-oauth
//      and persist re-encrypted tokens + new expirations.
//   3. If refresh fails with AuthenticationFailure (Intuit's 401 for a
//      revoked/expired refresh token), mark the connection inactive and
//      return null. The caller surfaces the Reconnect banner.

import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/encryption";
import { createOAuthClient } from "./oauth";
import { getQbConfig } from "./config";
import type { QbEnvironment } from "./config";
import type { QbConnectionRow } from "./types";

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

export interface ValidToken {
  accessToken: string;
  realmId: string;
  environment: QbEnvironment;
  connection: QbConnectionRow;
}

export async function getActiveConnection(
  supabase: SupabaseClient,
): Promise<QbConnectionRow | null> {
  const { data } = await supabase
    .from("qb_connection")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<QbConnectionRow>();
  return data ?? null;
}

export async function getValidAccessToken(
  supabase: SupabaseClient,
): Promise<ValidToken | null> {
  const connection = await getActiveConnection(supabase);
  if (!connection) return null;

  const cfg = getQbConfig();
  const now = Date.now();
  const accessExpires = Date.parse(connection.access_token_expires_at);
  const refreshExpires = Date.parse(connection.refresh_token_expires_at);

  // Refresh token itself expired — nothing to do but mark inactive and
  // prompt the user to reconnect.
  if (Number.isNaN(refreshExpires) || refreshExpires <= now) {
    await markInactive(supabase, connection.id, "refresh_token_expired");
    return null;
  }

  if (!Number.isNaN(accessExpires) && accessExpires - now > REFRESH_THRESHOLD_MS) {
    return {
      accessToken: decrypt(connection.access_token_encrypted),
      realmId: connection.realm_id,
      environment: cfg.environment,
      connection,
    };
  }

  // Refresh path.
  const refreshToken = decrypt(connection.refresh_token_encrypted);
  const oauth = createOAuthClient();
  try {
    const authResp = await oauth.refreshUsingToken(refreshToken);
    const token = authResp.getToken();
    const accessToken = token.access_token ?? "";
    const newRefreshToken = token.refresh_token ?? refreshToken;
    const expiresIn = token.expires_in ?? 3600;
    const refreshExpiresIn = token.x_refresh_token_expires_in ?? 8640000;

    const access_token_expires_at = new Date(now + expiresIn * 1000).toISOString();
    const refresh_token_expires_at = new Date(
      now + refreshExpiresIn * 1000,
    ).toISOString();

    await supabase
      .from("qb_connection")
      .update({
        access_token_encrypted: encrypt(accessToken),
        refresh_token_encrypted: encrypt(newRefreshToken),
        access_token_expires_at,
        refresh_token_expires_at,
      })
      .eq("id", connection.id);

    return {
      accessToken,
      realmId: connection.realm_id,
      environment: cfg.environment,
      connection: {
        ...connection,
        access_token_expires_at,
        refresh_token_expires_at,
      },
    };
  } catch (err) {
    // intuit-oauth throws with the raw Intuit error — AuthenticationFailure
    // means the refresh token is no longer accepted. Any failure here
    // leaves the connection usable only after manual reconnect.
    await markInactive(
      supabase,
      connection.id,
      err instanceof Error ? err.message : "refresh_failed",
    );
    return null;
  }
}

async function markInactive(
  supabase: SupabaseClient,
  connectionId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("qb_connection")
    .update({ is_active: false })
    .eq("id", connectionId);
  console.warn(`[qb] connection ${connectionId} marked inactive: ${reason}`);
}
