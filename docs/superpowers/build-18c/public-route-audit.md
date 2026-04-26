# Build 18c — Public Route Audit

**Timestamp:** 2026-04-25 (Session A)
**Author:** Claude Code (Session A)
**Branch:** `18c-prep`

Per plan §5.3 + §10 locked decision #5: cover **every file** under
`src/app/(public)/`, not just the three known from §13. Plus any other file
in the codebase that imports `AAA_ORGANIZATION_ID`.

## Methodology

1. `Glob src/app/(public)/**/*.{ts,tsx}` — enumerate every file under the
   public route group.
2. `Grep AAA_ORGANIZATION_ID src/` — find every import/use of the constant.
3. For each file: classify as **SAFE** (no DB access requiring tenant
   scope, OR already correctly derives org from token row) or **NEEDS FIX**.
4. Patch every NEEDS FIX so `organization_id` derives from the token-row
   instead of falling back to AAA's hardcode.
5. Verify post-fix by: (a) `npm run build` passes, (b) manually navigating
   to `/sign/{fake}`, `/pay/{fake}`, `/pay/{fake}/success` against the dev
   server and confirming the error shells render with **no AAA branding
   leak**.

## Files audited

### `src/app/(public)/`

| # | File | Type | DB access | Verdict | Action |
|---|---|---|---|---|---|
| 1 | `layout.tsx` | Server | None (CSS wrapper only) | **SAFE** | None |
| 2 | `sign/[token]/page.tsx` | Server | `contracts`, `contract_signers`, `company_settings` | **NEEDS FIX** | Refactored: load contract first, pass `contract.organization_id` to `loadCompany`. Pre-token-verify error path now uses `EMPTY_BRAND` (no AAA branding leak). |
| 3 | `sign/[token]/signing-form.tsx` | Client | None (POSTs to `/api/contracts/{id}/sign`) | **SAFE** | None — server-side API route already correct (uses `contract.organization_id` end-to-end; verified). |
| 4 | `pay/[token]/page.tsx` | Server | `payment_requests`, `company_settings`, `jobs`, `stripe_connection`, `payment_email_settings` | **NEEDS FIX** | Refactored: fetch PR first, pass `pr.organization_id` to `loadCompany`. **Also fixed multi-tenant bugs in `stripe_connection` and `payment_email_settings` queries** — they were using `.limit(1)` (selects any row) and now correctly scope by `pr.organization_id`. |
| 5 | `pay/[token]/method-selector.tsx` | Client | None (POSTs to `/api/pay/{token}/checkout`) | **SAFE** | None — server-side API route already correct (verified `getStripeClient(pr.organization_id)` at `src/app/api/pay/[token]/checkout/route.ts:62`). |
| 6 | `pay/[token]/success/page.tsx` | Server | `company_settings` (only) | **NEEDS FIX** | Rewrote: decode token, fetch `payment_requests.organization_id`, then load company by that org. Token-verify failure renders with `EMPTY_BRAND` (no AAA leak). |

### Other files importing `AAA_ORGANIZATION_ID` (post-fix grep)

| File | Use | Verdict | Action |
|---|---|---|---|
| `src/lib/supabase/get-active-org.ts` | Constant definition | **SAFE** | Retained (legitimate seed/script use per the file's own comment, lines 17–19; app code is now grep-clean). |

After the audit there is **exactly one** file in `src/` referencing
`AAA_ORGANIZATION_ID`: the definition site. No app-code consumer remains.

## Why the `stripe_connection` / `payment_email_settings` widening counts as in-scope

The three §13 named pages are the headline fixes, but plan §4.4 explicitly
says:

> anytime a build introduces multi-tenant infrastructure, the
> public-facing surface needs its own audit pass.

Both `stripe_connection` and `payment_email_settings` have an
`organization_id` column (verified via `information_schema.columns`). The
prior `.limit(1).maybeSingle()` pattern selects whichever row Postgres
hands back first — under single-org reality (today) that's AAA's, but
under multi-org it could be either, undefined. Scoping the SELECT by
`pr.organization_id` is the correct multi-tenant behavior and is a direct
beneficiary of the same fix pattern §13 named.

Classified as **minor — proceed** under Rule C and noted here so Session B
catches the change in the rehearsal.

## Verification

### Static
- `npm run build` — passes (single pre-existing NFT-trace warning for
  `next.config.ts` in `src/app/api/jarvis/rnd/route.ts`, unchanged from
  18b).
- `Grep AAA_ORGANIZATION_ID src/` — only `src/lib/supabase/get-active-org.ts`.

### Dynamic (dev server smoke)
- `/sign/not-a-real-token` → renders error card with title "This link is
  invalid", subtitle "Malformed token", **no AAA branding** (screenshot
  attached in Session A handoff §5).
- `/pay/not-a-real-token` → renders "This payment link is invalid" /
  "Malformed token", no AAA branding.
- `/pay/not-a-real-token/success` → renders "Payment submitted" / "Thank
  you" message, no AAA branding.
- All three return HTTP 200, no console errors, no server 500s.

Pre-fix, all three would have surfaced AAA's `company_name`, `phone`,
`email`, `address`, `logo_url` (because `loadCompany()` always fell
back to the AAA hardcode).

## Out of audit scope (intentional)

Post-fix, `AAA_ORGANIZATION_ID` is only used in scripts/seed paths outside
`src/`. Those scripts (`scripts/migrate-storage-paths.ts`, etc.) were not
re-audited — they are explicitly retained as legitimate AAA-targeted
operational tools per `get-active-org.ts:17–19`.

The webhook handlers (`src/app/api/stripe/webhook/route.ts` etc.) and
non-public API routes were not re-audited beyond confirming they don't
import `AAA_ORGANIZATION_ID`. They were extensively audited in 18b's
code-sweep. If a Session B finding surfaces a webhook regression, that's
a separate Rule C path.
