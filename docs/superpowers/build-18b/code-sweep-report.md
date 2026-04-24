# Build 18b — Code Sweep Report (Session A)

Report timestamp: 2026-04-23

Branch: `18b-prep`

Scope: per plan §5.3 — rewrite `getActiveOrganizationId()` to read from JWT, audit every AAA UUID reference, audit every PL/pgSQL function that INSERTs into an org-scoped table.

---

## 1. App-layer audit

### 1.1 Core helper

**[src/lib/supabase/get-active-org.ts](../../../src/lib/supabase/get-active-org.ts)** — rewritten.

Signature change:

```diff
- export function getActiveOrganizationId(): string
+ export async function getActiveOrganizationId(supabase: SupabaseClient): Promise<string | null>
```

Now calls `supabase.auth.getUser()` and reads `app_metadata.active_organization_id` from the authenticated user. Returns `null` if no user or claim missing. Per plan §5.3 the caller does NOT fall back to the AAA constant — `null` propagates to Postgres, where reads yield empty and inserts fail NOT NULL.

`AAA_ORGANIZATION_ID` is retained as a named export, but only for out-of-app uses: public pages, out-of-app scripts, and seed data targeting the one-tenant world (removed in 18c).

### 1.2 Call-site updates (58 files)

Every call site was rewritten to `await getActiveOrganizationId(<user-session supabase client>)`. Summary:

| Pattern | Count | Example |
|---|---|---|
| Inline in query | 42 | `.eq("organization_id", await getActiveOrganizationId(supabase))` |
| Variable assignment | 42 | `const orgId = await getActiveOrganizationId(supabase);` |
| Nullish coalesce | 2 | `current.organization_id ?? (await getActiveOrganizationId(supabase))` |

All call sites were already in async functions, so no cascading async conversions were required.

### 1.3 Route-handler client upgrades (14 files)

Fourteen API routes previously created only `createApiClient()` (anon-key) or `createServiceClient()` (service-role) clients — both bypass or lack the user session, so `getActiveOrganizationId` would return `null` against them. Each was upgraded to also create a `createServerSupabaseClient()` (cookies-bound) client and pass that into the helper:

- src/app/api/settings/statuses/route.ts
- src/app/api/settings/intake-form/route.ts
- src/app/api/settings/damage-types/route.ts
- src/app/api/settings/contract-templates/route.ts
- src/app/api/settings/contract-templates/[id]/duplicate/route.ts
- src/app/api/settings/company/route.ts
- src/app/api/settings/company/logo/route.ts
- src/app/api/jobs/[id]/files/route.ts
- src/app/api/email/accounts/route.ts
- src/app/api/settings/users/route.ts
- src/app/api/settings/users/[id]/route.ts
- src/app/api/settings/users/[id]/permissions/route.ts
- src/app/api/stripe/connect/callback/route.ts
- (one more — see `git diff`)

Existing service-role usage within these routes is preserved; the server client is used only for resolving the active org.

### 1.4 Special cases

**[src/lib/auth-context.tsx](../../../src/lib/auth-context.tsx)** — removed the hardcoded AAA constant. Now reads `user.app_metadata.active_organization_id` from the session user directly via a small `readActiveOrgClaim(user)` helper. `loadProfile(userId, activeOrgId)` takes the resolved org as a parameter. If the claim is missing, the membership/permissions lookup is skipped and the UI falls back to `crew_member` display role.

**[src/lib/jarvis/tools.ts](../../../src/lib/jarvis/tools.ts)** — `toolCreateAlert` replaced two hardcoded AAA UUIDs. Now: if `input.job_id` is set, use `jobs.organization_id`; otherwise call `getActiveOrganizationId(ctx.supabase)`. Returns a user-facing error if no org can be resolved.

**[src/lib/notifications/write.ts](../../../src/lib/notifications/write.ts)** — `organizationId` parameter was optional with a hardcoded-helper fallback. Now required. The 5 existing callers (all in Stripe webhook handlers) already passed it from the source row, so no caller updates were needed.

**[src/lib/stripe.ts](../../../src/lib/stripe.ts)** — `loadStripeConnection`, `getStripeClient`, and `getPublicKey` previously accepted an optional `orgId` with a hardcoded-helper fallback. All three now require `orgId: string`. `lib/stripe.ts` uses a service-role client internally and can't resolve the active org from a session JWT; callers know the org and must pass it. 7 callers updated:

- src/app/settings/stripe/page.tsx — now resolves org from server client before calling
- src/app/api/pay/[token]/checkout/route.ts — uses `pr.organization_id` from loaded payment_request
- src/app/api/payment-requests/route.ts — reorder to resolve orgId BEFORE calling getStripeClient; returns 401 on null
- src/app/api/payment-requests/[id]/refund/route.ts — uses `payment.organization_id` (added to SELECT)
- src/app/api/payment-requests/[id]/void/route.ts — uses `pr.organization_id`
- src/lib/stripe/webhook/handlers/payment-intent-succeeded.ts — uses `pr.organization_id`
- src/lib/stripe/webhook/handlers/charge-refunded.ts — uses `payment.organization_id`

**[src/app/api/stripe/webhook/route.ts](../../../src/app/api/stripe/webhook/route.ts)** — `resolveOrgFromStripeEvent` no longer falls back to the AAA helper for pre-18a events. Now returns `string | null`; POST handler logs and 200s (`{ok: true, dropped: "no_org_metadata"}`) if metadata is missing, instead of silently routing to AAA. Stripe sees 200 so it stops retrying; we log for audit.

**3 public pages** (sign/[token], pay/[token], pay/[token]/success) — these run without any user session. Replaced the `getActiveOrganizationId()` fallback with the `AAA_ORGANIZATION_ID` constant for the error-path branding lookup only. Legitimate constant use: these pages are issued by AAA for AAA's customers, and 18c (workspace switcher) is where they'd need to become tenant-aware.

### 1.5 AAA UUID literal sweep

After the rewrite, the AAA UUID literal (`a0000000-0000-4000-8000-000000000001`) appears in `src/` exclusively at the `AAA_ORGANIZATION_ID` constant declaration in `src/lib/supabase/get-active-org.ts`. All other in-app references (notably `src/lib/jarvis/tools.ts` and `src/lib/auth-context.tsx`) were replaced.

Legitimate remaining references outside `src/`:
- `scripts/migrate-storage-paths.ts` — out-of-app script targeting AAA (retained)
- `supabase/` migration files — seed data, comments
- `docs/` — historical plans and handoffs

No fully-qualified `nookleus.aaa_organization_id` RPC calls were found in `src/` — only in docs and the build42/build58 migrations.

---

## 2. SQL trigger / function audit

Per plan §4.1 (lesson from 18a), every PL/pgSQL function in `public` and `nookleus` was queried and classified. 40 functions audited.

### 2.1 SAFE (no org-scoped INSERTs) — 14 functions

Functions that only UPDATE, DELETE, SELECT, mutate NEW/OLD, or INSERT into user-scoped (non-org) tables:

- `bump_vendor_last_used` — UPDATE vendors.last_used_at
- `delete_expense_cascade` — DELETE only
- `execute_readonly_query` — SELECT-only; blocks mutations
- `generate_job_number` — deprecated stub; raises
- `handle_new_user` — trigger on auth.users; inserts to user_profiles (user-scoped, no org column)
- `mark_contract_signed` — UPDATE only
- `recompute_invoice_status` — UPDATE only
- `recompute_job_payer_type` — UPDATE only
- `reset_job_number_seq` — ALTER SEQUENCE
- `schedule_first_reminder` — UPDATE only
- `search_knowledge_chunks` — SELECT-only
- `set_default_permissions` — INSERTs user_organization_permissions (scoped via user_organization_id FK, no org_id column) and user_permissions (deprecated, user-scoped)
- `set_invoice_number` / `set_job_number` — triggers that mutate NEW only
- `storage_paths_swap_to_new` — UPDATE only
- `trg_payments_recompute_invoice_status` / `trg_recompute_payer_type` — trigger wrappers, no INSERT
- `update_expense` — UPDATE only
- `update_updated_at` — trigger mutates NEW.updated_at

### 2.2 SAFE (already sets organization_id) — 11 functions

INSERTs into org-scoped tables with `organization_id` correctly sourced:

- `create_contract_draft` — jobs lookup with null-raise guard; inserts contracts, contract_signers, contract_events with `v_org_id`
- `create_contract_with_signers` — same pattern
- `create_expense_with_activity` — jobs lookup with null-raise guard; inserts job_activities, expenses
- `notify_admins` — requires `p_job_id`; jobs lookup with null-raise guard; inserts notifications
- `next_invoice_number` / `next_job_number` — insert org_number_counters with `p_org_id` parameter
- `trg_qb_enqueue_contact_update` — `NEW.organization_id`
- `trg_qb_enqueue_invoice_update` — 3 inserts, all sourced from `NEW.organization_id` / `contact_row.organization_id` / `job_row.organization_id`
- `trg_qb_enqueue_job_insert` — `contact_row.organization_id` and `NEW.organization_id`
- `trg_qb_enqueue_job_update` — `NEW.organization_id`
- `trg_qb_enqueue_line_item_change` — `inv.organization_id` via parent invoice lookup (returns early if inv missing)
- `trg_qb_enqueue_payment_delete` — `OLD.organization_id`
- `trg_qb_enqueue_payment_insert` / `trg_qb_enqueue_payment_update` — `NEW.organization_id`

The 8 `trg_qb_enqueue_*` functions confirm the build54 patch; each INSERT into `qb_sync_log` carries `organization_id`.

### 2.3 WARN — 7 functions (resolved by build59)

All 7 INSERT into `public.contract_events` (confirmed `organization_id NOT NULL`, no default) without `organization_id` in the column list. A direct test on scratch confirmed the INSERT fails with `null value in column "organization_id" of relation "contract_events" violates not-null constraint`:

| Function | Called from | Issue |
|---|---|---|
| `activate_next_signer` | api/contracts/[id]/sign/route.ts:250 | missing organization_id |
| `mark_contract_expired` | (public)/sign/[token]/page.tsx:99, api/sign/[token]/route.ts:60 | missing organization_id |
| `mark_contract_sent` | api/contracts/send/route.ts:201 | missing organization_id |
| `mark_reminder_sent` | lib/contracts/reminders.ts:73 | missing organization_id |
| `record_signer_signature` | api/contracts/[id]/sign/route.ts:182 | missing organization_id |
| `resend_contract_link` | api/contracts/[id]/resend/route.ts:85 | missing organization_id |
| `void_contract` | api/contracts/[id]/void/route.ts:94 | missing organization_id |

**Resolution:** this was a **Rule C material** finding. Eric approved Option A: ship a build59 migration that patches all 7 RPCs using the uniform parent-lookup pattern (same class as build54, different table). See `supabase/migration-build59-contract-event-rpcs-organization-id.sql`. The defect is pre-existing — 18b Session A surfaced it by auditing function bodies that were never exercised heavily enough to show up in logs (44 existing `contract_events` rows all predate 18a and come from the app-layer writers in `src/lib/contracts/audit.ts`, `src/lib/contracts/reminders.ts:64`, and `src/lib/payments/activity.ts`, all of which correctly set `organization_id`).

---

## 3. Deliverables summary

- Migrations authored (5): build55, build56, build57, build58, build59
- Rollback artifact: `supabase/build57-rollback.sql`
- Files modified in src/: 60 (58 call-site refactors + auth-context.tsx + jarvis/tools.ts; plus the two stripe-related lib/stripe.ts and stripe webhook refactors counted separately)
- `npm run build`: passes
- Prod DDL/DML: none
- Pushes to main: none
