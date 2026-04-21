# Build 17c — Pre-planning briefing

> **Purpose:** Hand this to a fresh Claude session before starting the 17c brainstorm. Everything here is context that won't be obvious from code or git history alone.

---

## TL;DR

**17b shipped to production on 2026-04-21** (PRs [#20](https://github.com/ericdaniels22/aaa-platform/pull/20) + [#21](https://github.com/ericdaniels22/aaa-platform/pull/21), merge commit `24e861d`). Customers can now receive payment request emails, open `/pay/<token>`, and complete Stripe Checkout for ACH or card payments.

**What 17b does NOT do:** the platform has no idea when a payment actually succeeds. `payment_requests.status` stays at `viewed` forever. No receipt email, no automatic reconciliation to the invoice's outstanding balance, no refund handling. This is what 17c must fix.

**Production is currently safe for pilot use but not scalable** — every successful payment requires the operator to check the Stripe dashboard and manually record a `payments` row via the Billing section's `+ Record Payment` button. That's fine for 5 customers, untenable for 50.

---

## 17b feature surface (what's already there)

### New tables / migrations (build40 migration applied 2026-04-21)

- `payment_email_settings` — singleton row. Templates for request + reminder emails, Resend/SMTP provider toggle, fee disclosure text, reminder day offsets, default link expiry.
- `contract_events.contract_id` was relaxed to NULLABLE so payment-scoped events log into the same audit table. `event_type` CHECK already permits `sent`, `link_viewed`, `reminder_sent`, `voided`, `expired`, `email_delivered`, `email_opened` — no schema change needed for 17c.

### New routes

- `GET /api/settings/payment-email` + `PATCH /api/settings/payment-email` — read + patch settings.
- `POST /api/payment-requests/[id]/send` — triggers the send flow for a draft request; transitions status `draft → sent`.
- `POST /api/pay/[token]/checkout` — public (token-gated); reuse-vs-regenerate Stripe Checkout Session logic with a 23.5-hour cap.
- `GET /api/jobs/[id]/contact-email` — helper for modal prefill (hotfix added late in 17b).
- `/pay/[token]` — public payment page with status shells (invalid/voided/expired/paid + main view).
- `/pay/[token]/success` — informational confirmation after Stripe Checkout redirect.
- `/settings/payments` — admin settings UI.

### New library modules

- `src/lib/payment-emails.ts` — `sendPaymentRequestEmail(id)` and `sendPaymentReminderEmail(id)` high-level orchestrators. These handle settings load, merge-field resolution, sending, status + reminder updates, audit log. **17c's webhook handler must coordinate with these** (e.g., a receipt email dispatcher in 17c likely follows the same shape).
- `src/lib/payments/types.ts` — `PaymentEmailSettings`, `PaymentRequestRow`, merge-extras definitions.
- `src/lib/payments/merge-fields.ts` — superset of the contract merge-field resolver. Adds Payment + Invoice field groups. Exports `formatUsd()`.
- `src/lib/payments/email.ts` — Resend/SMTP router for payment emails. Intentionally duplicates ~70 lines from `src/lib/contracts/email.ts` to avoid touching Build 15 code. **A future consolidation pass could merge both into a shared `src/lib/email-provider.ts` — not required for 17c but worth considering when adding receipt emails.**
- `src/lib/payments/activity.ts` — `writePaymentEvent()` helper; writes rows with `contract_id=null` and `metadata.payment_request_id`.

### Modified files

- `middleware.ts` — added `/sign/` and `/pay/` to the public-route bypass. **See "open questions" below.**
- `src/components/app-shell.tsx` — added `/pay` to `PUBLIC_ROUTES` alongside `/sign` so admins viewing the pay page in-session don't see the authenticated chrome.
- `src/components/payments/online-payment-requests-subsection.tsx` — Send / Copy link / View as customer actions; STATUS_STYLES amber for sent/viewed per v1.7 design.
- `src/components/payments/payment-request-modal.tsx` — Recipient email field (prefilled from contact, editable).
- `src/lib/settings-nav.ts` — "Payment Emails" entry after "Stripe Payments".
- `src/app/api/payment-requests/route.ts` — accepts optional `payer_email` / `payer_name` in the POST body to override the contact lookup.

---

## Key architectural decisions 17c must respect

1. **Stripe session 23.5-hour cap.** Defined as `STRIPE_SESSION_MAX_MS = 23.5 * 60 * 60 * 1000` in both `src/app/api/payment-requests/route.ts` and `src/app/api/pay/[token]/checkout/route.ts`. Payment tokens outlive the Stripe session; the regeneration route creates fresh sessions on each click when the previous session expired or the method/surcharge changed. **17c's webhook must not attempt to validate against the session that was attached to the request at send-time** — the `stripe_checkout_session_id` field mutates over the request's lifetime. Rely on `payment_intent.metadata.payment_request_id` instead, which is set on every regeneration.

2. **Idempotent webhook processing.** The `stripe_events` table (created in build39 migration, never populated by 17a/17b) exists precisely for this. Store `stripe_event_id` UNIQUE, look up before processing, mark `processed_at` on success.

3. **Pre-payment fields persisted.** `/api/pay/[token]/checkout` writes `card_fee_amount`, `total_charged`, and `payment_method_type` to the `payment_requests` row BEFORE returning the Stripe URL. **The webhook should verify the actual captured amount matches `total_charged` and flag mismatch** (probably just log + still mark paid, since the customer paid what Stripe says, not what we expected).

4. **Audit log reuse.** All payment events go into `contract_events` with `contract_id=null`. 17c's new event types (`paid`, `refunded`, `partially_refunded`, `failed`) are NOT in the existing CHECK constraint. **17c will likely need a migration to widen the CHECK.** Alternatively, stash the actual event type inside `metadata.kind` and use a generic `event_type='paid'` if we want to avoid a migration — less clean but zero schema risk.

5. **Single stripe_connection row pattern.** 17a uses delete-then-insert on upsert. The connection row has `webhook_signing_secret_encrypted` but it's never set — 17c needs to expose a UI at `/settings/stripe` for pasting the webhook signing secret (or fetch it via the Stripe API using the connected account's access token).

6. **Sender pattern for customer emails.** Receipt emails in 17c should use the same `payment_email_settings` row (same send-from address, same provider choice) as the payment request email. Do NOT introduce a separate receipts settings table.

---

## Open questions to resolve before writing the 17c plan

1. **Middleware `/sign/` bypass was added in 17b without explicit user confirmation.** Before 17b, `src/components/app-shell.tsx` had `PUBLIC_ROUTES = ["/sign"]` but `middleware.ts` did NOT exempt `/sign/` from the auth redirect — meaning Build 15's contract signing may have been silently redirecting unauthenticated customers to `/login` since it shipped. I added `/sign/` to both the middleware bypass and the AppShell's list. **Confirm with user:** was Build 15 ever successfully tested with an unauthenticated external signer? If yes, there's a flow I didn't see that I should understand. If no, my fix is legitimate and we should test the `/sign/` flow once end-to-end before 17c ships (so both flows work).

2. **Internal payment notifications.** Spec v1.7 implies internal team gets an email when a customer pays ("you just received a payment for job X"). Confirm with user: should we mirror the contract pattern (`signed_confirmation_internal_subject_template` / `..._body_template` in `contract_email_settings`) and add analogous fields to `payment_email_settings`? Or skip internal notifications entirely and rely on the Stripe dashboard?

3. **Partial refund UX.** Admin triggers refund from where? The job Billing section's payment_request row? An invoice detail page? Stripe dashboard only (we just passively listen for the webhook)? This affects whether 17c needs a refund modal + endpoint or only the webhook side.

4. **QuickBooks sync timing.** 16c (QuickBooks) is already shipped. Do we auto-push a Stripe-collected payment to QB the moment the webhook fires, or only on an explicit "Sync to QuickBooks" action? The existing `/api/qb/*` routes may or may not already handle this path.

5. **Receipt PDF source of truth.** Stripe generates its own payment receipt URL (`payment_intent.charges[0].receipt_url`). Are we generating our own branded PDF and attaching it to the receipt email, or linking to Stripe's? Branded PDF matches the contract flow but adds ~200 lines of work; Stripe's URL is one line.

---

## 17c scope (from the 17b plan, Part 1)

Literal excerpt from `docs/superpowers/plans/2026-04-20-build-17b-payment-page-email.md`:

> Explicitly NOT in this build (later sub-builds):
> - Webhook handler at `/api/stripe/webhook` — status stays in sent/viewed even after Stripe completes payment. **17c will flip status to paid.**
> - Internal receipt PDF generation — **17c**
> - Customer receipt emails, refund emails, internal notifications — **17c**
> - Refund flow, reminder scheduler, void enhancements — **17d**
> - QuickBooks sync integration — **17c**

Everything tagged 17c in that list is in scope for the next plan. 17d (refund UX + reminder scheduler) can be debated — refund flow MIGHT belong in 17c if we're implementing the webhook side of refunds anyway.

---

## Environment + infrastructure facts

- **Stripe test connection:** `acct_1TOB8T5UrW5Xt1eB` (test mode). ACH + card enabled. Surcharge off, no ACH threshold. This is the tenant's only connected account.
- **Resend sending domain `aaadisasterrecovery.com` is verified** as of 2026-04-20. Sends to arbitrary customer inboxes now work. Use `payments@aaadisasterrecovery.com` or similar as send-from.
- **Supabase migration high-water:** build40. Next feature uses build41.
- **Vercel deploy:** main auto-deploys to `aaaplatform.vercel.app`. No staging. Dev = prod per project memory.
- **No test framework** — "tests" = tsc + `npm run build` + manual preview walkthrough. Current tsc baseline is clean.
- **Single-tenant SaaS** — no multi-org logic to worry about. `stripe_connection`, `payment_email_settings`, `contract_email_settings` are all singleton rows.

---

## Watch-outs

1. **Two public-route lists.** Both `middleware.ts` and `src/components/app-shell.tsx` have to know about a public path. Adding `/pay` required updating both — adding a new public route for 17c (e.g. `/receipt/<token>` if we expose a public receipt view) will need both edits again. Consider extracting a shared constant in one follow-up refactor.

2. **`public-card` + `public-muted` CSS classes only work inside `src/app/(public)/layout.tsx`'s `<div className="public-scope">`.** If 17c adds a public receipt page, it must live under `(public)/` or the light-theme styles won't apply.

3. **Stripe webhook signing secret is encrypted in DB via `src/lib/encryption.ts`.** The encryption module is used by Build 12 (email SMTP passwords), Build 17a (Stripe secret key), and potentially 17c (webhook signing secret). DO NOT modify `src/lib/encryption.ts`.

4. **Single-row tables use "delete-then-insert" for updates** — see 17a's `stripe_connection` disconnect flow. If 17c touches stripe_connection (e.g. to store the webhook signing secret), follow the same pattern OR just add a PATCH handler.

5. **Card fee percent is stored as `numeric(5,2)` in DB.** Supabase returns it as a STRING from the client library. Always `Number(connection.card_fee_percent)` before arithmetic. Same for `amount`, `card_fee_amount`, `total_charged`, `ach_preferred_threshold`.

6. **The 17b plan at `docs/superpowers/plans/2026-04-20-build-17b-payment-page-email.md` has 3 flagged deviations from the original spec** (header section "Spec deviations"). Read them before extending the `/settings/payments` page or `/pay/[token]` route — especially the `(public)` route group placement and the dirty-flag + Save button pattern (NOT auto-save).

---

## Reference pointers

- **17b plan:** `docs/superpowers/plans/2026-04-20-build-17b-payment-page-email.md`
- **17a plan:** `docs/superpowers/plans/2026-04-20-build-17a-stripe.md` (authoritative for token format, schema, and session regeneration architecture — 17b incorporates its decisions)
- **Build Guide v1.7 (user's canonical spec):** `C:\Users\14252\Downloads\AAA-Platform-Build-Guide-v1_7.docx` — Part 7 Webhooks is where 17c's customer-facing requirements live
- **Stripe webhook dashboard:** will be configured at <https://dashboard.stripe.com/test/webhooks> when 17c wires up its endpoint
- **Project memory directory:** `C:/Users/14252/.claude/projects/C--Users-14252-Desktop-aaa-platform/memory/` — notable for 17c: `project_17c_next.md`, `reference_resend_domain.md`, `project_migration_convention.md`

---

## Suggested opening to the 17c brainstorm

> "Read this briefing first: `docs/superpowers/plans/2026-04-21-build-17c-briefing.md`. Then read `docs/superpowers/plans/2026-04-20-build-17b-payment-page-email.md` end-to-end — especially the 'Spec deviations' and 'Explicitly NOT touched' sections — and `docs/superpowers/plans/2026-04-20-build-17a-stripe.md` for the authoritative Stripe architecture.
>
> Before writing any 17c plan, surface the 5 open questions from the briefing so I can resolve them. Then brainstorm the webhook handler + status sync + receipt flow + refund handling + QuickBooks push. Use the superpowers:brainstorming skill.
>
> We're on the Hobby Vercel plan so cron is daily-only — the reminder scheduler (17d scope) may inherit that constraint."
