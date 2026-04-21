// Active-organization helper. Every server-side query that reads or writes
// a bucket-A/B tenant table must scope by this value.
//
// In 18a this is a hardcoded constant pointing at AAA Disaster Recovery —
// AAA is the only live tenant. 18b replaces this with a session-sourced
// read (nookleus.active_organization_id() via the JWT claim set by the
// custom access token hook). The string values are also exported for
// consumption by ad-hoc service-role scripts and cron routes.
//
// TODO(18b): Replace with session-sourced org. Read the JWT claim via
// supabase.auth.getUser() + session.user.app_metadata.active_organization_id
// (or the top-level claim once the hook is wired). Service-role callers
// with no user context stay on the hardcoded helper until they grow a
// per-request org parameter.

export const AAA_ORGANIZATION_ID = "a0000000-0000-4000-8000-000000000001";

/**
 * Returns the active organization id for the current request.
 *
 * 18a: always AAA. 18b: reads from session.
 */
export function getActiveOrganizationId(): string {
  return AAA_ORGANIZATION_ID;
}
