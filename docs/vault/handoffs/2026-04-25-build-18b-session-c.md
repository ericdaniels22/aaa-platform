---
date: 2026-04-25
build: 18b
session: c
status: shipped
---

#area/multi-tenant #area/rls #build/18b #status/shipped

# Build 18b — Session C handoff (prod apply)

**Shipped 2026-04-25.** Flipped multi-tenant Row-Level Security from "transitional permissive" to "tenant_isolation as the sole gate" in production.

Migrations applied in order: build55 (custom_access_token_hook), build59 (contract RPC org_id patches), build56 (drop redundant policies), **build60 (Rule C MATERIAL forward-fix mid-session — `auth_admin_read_user_organizations` SELECT policy so the hook can read user_organizations under RLS)**, build57 (drop 48 legacy `Allow all*` + 10 `transitional_allow_all_*`), build58 (drop `nookleus.aaa_organization_id()` helper).

Post-18b: `app_metadata.active_organization_id` is injected into every JWT by `public.custom_access_token_hook`; `nookleus.active_organization_id()` reads from `auth.jwt()`; `tenant_isolation_*` policies are the only thing standing between an authenticated user and another tenant's rows.

## Source

- Original document: [docs/superpowers/build-18b/session-c-handoff.md](../../../docs/superpowers/build-18b/session-c-handoff.md)
- Run log: [docs/superpowers/build-18b/session-c-run-log.md](../../../docs/superpowers/build-18b/session-c-run-log.md)
- Build card: [[build-18b]]
- Plan: [docs/superpowers/plans/2026-04-23-build-18b-rls-enforcement.md](../../../docs/superpowers/plans/2026-04-23-build-18b-rls-enforcement.md)
- Commits: `2aaf22f session-c(18b): build60 RLS policy for custom_access_token_hook`, `2240df6 session-c(18b): build57+58 applied, smokes PASS, handoff written`
