// Active-organization helper. Every server-side query that reads or writes
// a tenant-scoped table must scope by this value.
//
// As of 18b, this reads the `app_metadata.active_organization_id` claim
// injected by public.custom_access_token_hook at token issuance time.
// The claim lives in the JWT only — `auth.users.raw_app_meta_data` is NOT
// updated by the hook, so we decode the access token directly rather than
// going through `supabase.auth.getUser().app_metadata`, which reads the DB
// column and would always return undefined.
// Missing claim returns null — callers pass null straight through to
// Postgres, where reads yield empty results and writes fail NOT NULL
// (both loud signals, never silent data leakage).

import type { SupabaseClient } from "@supabase/supabase-js";

// The AAA org UUID is retained only for out-of-app scripts and seed data
// that legitimately target AAA (e.g. scripts/migrate-storage-paths.ts).
// App code must NOT fall back to this constant — it would mask missing
// claims and reintroduce the tenant-leak risk 18b eliminates.
export const AAA_ORGANIZATION_ID = "a0000000-0000-4000-8000-000000000001";

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  if (typeof atob === "function") return atob(padded);
  return Buffer.from(padded, "base64").toString("utf-8");
}

/**
 * Returns the active organization id for the current request by decoding the
 * `active_organization_id` claim from the user's access-token JWT.
 *
 * - Requires a Supabase client with the user's auth context (browser client,
 *   server client built from cookies, or route-handler client). A service-role
 *   client has no user session and will return null.
 * - Returns null if the user is unauthenticated, the JWT is malformed, or the
 *   claim is not present. Callers should pass null through to Postgres: reads
 *   return empty, inserts into org-scoped tables hit NOT NULL and throw.
 */
export async function getActiveOrganizationId(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(decodeBase64Url(parts[1])) as {
      active_organization_id?: unknown;
      app_metadata?: { active_organization_id?: unknown };
    };
    const claim =
      payload.app_metadata?.active_organization_id ??
      payload.active_organization_id;
    return typeof claim === "string" && claim.length > 0 ? claim : null;
  } catch {
    return null;
  }
}
