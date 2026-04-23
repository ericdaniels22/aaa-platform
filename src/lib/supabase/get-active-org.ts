// Active-organization helper. Every server-side query that reads or writes
// a tenant-scoped table must scope by this value.
//
// As of 18b, this reads the `app_metadata.active_organization_id` claim
// injected by public.custom_access_token_hook at token issuance time.
// Missing claim returns null — callers pass null straight through to
// Postgres, where reads yield empty results and writes fail NOT NULL
// (both loud signals, never silent data leakage).

import type { SupabaseClient } from "@supabase/supabase-js";

// The AAA org UUID is retained only for out-of-app scripts and seed data
// that legitimately target AAA (e.g. scripts/migrate-storage-paths.ts).
// App code must NOT fall back to this constant — it would mask missing
// claims and reintroduce the tenant-leak risk 18b eliminates.
export const AAA_ORGANIZATION_ID = "a0000000-0000-4000-8000-000000000001";

/**
 * Returns the active organization id for the current request by reading the
 * `app_metadata.active_organization_id` claim on the authenticated user.
 *
 * - Requires a Supabase client with the user's auth context (browser client,
 *   server client built from cookies, or route-handler client). A service-role
 *   client has no user session and will return null.
 * - Returns null if the user is unauthenticated or the claim is not present.
 *   Callers should pass null through to Postgres: reads return empty,
 *   inserts into org-scoped tables hit NOT NULL and throw.
 */
export async function getActiveOrganizationId(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  const claim = user?.app_metadata?.active_organization_id;
  return typeof claim === "string" && claim.length > 0 ? claim : null;
}
