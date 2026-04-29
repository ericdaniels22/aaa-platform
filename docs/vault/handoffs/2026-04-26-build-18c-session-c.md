---
date: 2026-04-26
build: 18c
session: c
status: shipped
---

#area/multi-tenant #build/18c #status/shipped

# Build 18c — Session C handoff (prod apply)

**Shipped 2026-04-26.** Workspace switcher live in prod. Migrations build62 + build62b applied; build63 added mid-session as a forward-fix for a latent 18b regression (`user_profiles_authenticated_read` SELECT policy).

What 18c delivered:

- `user_organizations.is_active` column with partial unique index `user_orgs_one_active_per_user` (one active per user).
- `public.custom_access_token_hook(jsonb)` updated to prefer the `is_active=true` membership when minting `app_metadata.active_organization_id`, with `ORDER BY created_at ASC` defensive fallback.
- `public.set_active_organization(p_org_id uuid)` SECURITY DEFINER RPC for the switcher.
- Workspace switcher UI (top-right avatar dropdown; hidden when user has < 2 memberships).
- Three public-route pages (`/sign/[token]`, `/pay/[token]`, `/pay/[token]/success`) fixed to derive `organization_id` from token rows instead of `AAA_ORGANIZATION_ID` fallback. Plus `/pay/[token]` now scopes `stripe_connection` and `payment_email_settings` queries by `pr.organization_id` instead of `.limit(1)`.
- ConfigProvider cold-incognito race fix — waits for `INITIAL_SESSION` before fetching `damage_types`/`job_statuses`.

A separate FK violation surfaced in step 15 ("invite a user via /settings/users") leading to [[build-64]] — the missing `on_auth_user_created` trigger on `auth.users`.

## Source

- Original document: [docs/superpowers/build-18c/session-c-handoff.md](../../../docs/superpowers/build-18c/session-c-handoff.md)
- Run log: [docs/superpowers/build-18c/session-c-run-log.md](../../../docs/superpowers/build-18c/session-c-run-log.md)
- Build card: [[build-18c]]
- Commits: `5eedd76 session-c(18c): build62/62b applied + build63 forward-fix, smokes PASS, handoff written`, `90d7405 session-d(18c): fix RLS-broken API routes — use cookie-aware SSR client`, `9e986b2 fix(auth): decode JWT directly for active_organization_id claim (#39)`
