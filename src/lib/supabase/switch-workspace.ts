// Workspace switcher action. Called from src/components/user-menu.tsx.
//
// Three-step flow:
//   1. Call public.set_active_organization(p_org_id) — RPC flips
//      user_organizations.is_active flags atomically. Validates membership;
//      raises 'not_a_member' as a Postgres exception if the caller isn't a
//      member of the target org.
//   2. supabase.auth.refreshSession() — issues a fresh access token. The
//      custom_access_token_hook fires during refresh and reads the newly-set
//      is_active row, baking the new active_organization_id claim into the
//      JWT.
//   3. window.location.reload() — server components re-render with the new
//      claim. Without a hard reload, only client components that re-read
//      the JWT would update.
//
// Throws on any step failure. Caller should toast the message.
//
// Module side-effect-free if not called.

import { createClient } from "@/lib/supabase";

export async function switchWorkspace(orgId: string): Promise<void> {
  const supabase = createClient();

  const { error: rpcError } = await supabase.rpc("set_active_organization", {
    p_org_id: orgId,
  });
  if (rpcError) {
    throw new Error(rpcError.message || "Failed to switch workspace");
  }

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    throw new Error(refreshError.message || "Failed to refresh session");
  }

  window.location.reload();
}
