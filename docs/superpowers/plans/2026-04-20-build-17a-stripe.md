# Build 17a — Stripe Connection & Payment Request Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe Standard OAuth connection (stored encrypted in DB, not `.env`), a `/settings/stripe` page to manage it, backend ability to create Stripe Checkout Sessions tracked as `payment_requests`, and the "Request Online Payment" / "Request Deposit" entry points on invoice and job detail pages. Webhook handling and customer `/pay/[token]` page are **out of scope** (17b/17c).

**Architecture:**
- Secrets encrypted with the existing `src/lib/encryption.ts` (AES-256-GCM), mirroring `email_accounts`.
- OAuth state is a short-lived signed blob using a new `STRIPE_CONNECT_STATE_SECRET` env var.
- Payment-link tokens reuse the HS256 JWT pattern from `src/lib/contracts/tokens.ts` with the existing `SIGNING_LINK_SECRET`.
- Server-only Stripe SDK access goes through `src/lib/stripe.ts#getStripeClient()`; callers never touch decrypted keys directly.
- UI mirrors `src/app/settings/email/page.tsx` patterns (sonner toasts, debounced auto-save, shadcn primitives, existing OKLCH dark-mode tokens).

**Tech Stack:** Next.js 15+ App Router (dynamic `params` is `Promise`), TypeScript strict, Tailwind + shadcn/ui, Supabase (service client for server routes, anon for client reads gated by RLS), `stripe` SDK + `@stripe/stripe-js`, `sonner` for toasts, `date-fns` for relative times.

**Important conventions (verified from current tree):**
- Migration files are **flat**: `supabase/migration-build<NN>-<name>.sql`. Highest on disk is `migration-build38-invoice-payment-sync.sql`, so this build uses **`migration-build39-stripe-payments.sql`**. If a newer migration has landed before you run, rename to `build<NN+1>`.
- No test runner (no jest/vitest/playwright). "Verification" = `npx tsc --noEmit` (baseline is clean), `npm run build`, and a manual preview walkthrough against the Part 8 checklist.
- Dynamic route handlers must `await params`: `{ params }: { params: Promise<{ id: string }> }`.
- Permissions come from `useAuth().hasPermission("key")` ([src/lib/auth-context.tsx](src/lib/auth-context.tsx)). Server-side: re-query `user_permissions` with the service client (admin role bypasses).
- Server routes using tables with RLS must use the service client ([src/lib/supabase/service.ts](src/lib/supabase/service.ts) — same pattern as the invoice-email settings route fix in `b45be07`).

---

## File Structure

**New files:**
- `supabase/migration-build39-stripe-payments.sql` — DDL for `stripe_connection`, `payment_requests`, `stripe_events`; column additions on `invoices`, `jobs`; RLS + grants.
- `src/lib/stripe.ts` — `getStripeClient()`, `getPublicKey()`, `loadStripeConnection()`, `StripeNotConnectedError`.
- `src/lib/stripe-oauth.ts` — `signOAuthState()`, `verifyOAuthState()`, `InvalidOAuthStateError`.
- `src/lib/payment-link-tokens.ts` — `generatePaymentLinkToken()`, `verifyPaymentLinkToken()`, `InvalidPaymentLinkTokenError` (pattern from `contracts/tokens.ts`).
- `src/components/ui/switch.tsx` — shadcn switch primitive (not currently present).
- `src/components/ui/label.tsx` — shadcn label primitive (not currently present).
- `src/app/api/stripe/connect/start/route.ts` — POST, redirects to Stripe OAuth.
- `src/app/api/stripe/connect/callback/route.ts` — GET, exchanges code, upserts row.
- `src/app/api/stripe/disconnect/route.ts` — POST, clears row.
- `src/app/api/stripe/settings/route.ts` — GET (read settings) + PATCH (update toggles, descriptor).
- `src/app/api/payment-requests/route.ts` — POST (create), GET (list by job).
- `src/app/api/payment-requests/[id]/route.ts` — GET single.
- `src/app/api/payment-requests/[id]/void/route.ts` — POST void.
- `src/app/settings/stripe/page.tsx` — server component, loads initial connection state.
- `src/app/settings/stripe/stripe-settings-client.tsx` — "use client" UI (connect / connected / toggles).
- `src/components/payments/payment-request-modal.tsx` — shared modal for invoice + job deposit flows.
- `src/components/payments/online-payment-requests-subsection.tsx` — list of requests in the job Billing card.

**Modified files:**
- `package.json` — add `stripe`, `@stripe/stripe-js`.
- `.env.example` — document `STRIPE_CONNECT_STATE_SECRET` and the Stripe OAuth client ID env var.
- `src/lib/settings-nav.ts` — insert "Stripe Payments" item between Accounting and Reports (lines 44/45).
- `src/components/invoices/invoice-detail-client.tsx` — add "Request Online Payment" button + modal wiring in header action area.
- `src/components/billing/billing-section.tsx` — add `OnlinePaymentRequestsSubsection` between progress bar and "+ Record Payment" button; add "+ Request Deposit" button.

**Do NOT touch:** `src/lib/encryption.ts`, existing Stripe webhook stub at `src/app/api/stripe/webhooks/route.ts`, the three-card job header layout, the existing `RecordPaymentModal`, the `/settings` sidebar styling, or any `globals.css` color tokens.

---

## Preflight

- [ ] **P1: Verify clean baseline**

```bash
git status
npx tsc --noEmit
```
Expected: clean tree on branch `claude/clever-fermi-b20016`; tsc returns 0 errors. If not, stop and resolve before proceeding.

- [ ] **P2: Verify migration number**

```bash
ls supabase/migration-build*.sql | sort -V | tail -3
```
Expected latest is `migration-build38-invoice-payment-sync.sql`. If something higher exists, substitute `build<next>` everywhere this plan says `build39`.

- [ ] **P3: Confirm env prerequisites exist**

Read `.env.local`. `ENCRYPTION_KEY` (64 hex chars), `SIGNING_LINK_SECRET` (≥32 chars), and `NEXT_PUBLIC_APP_URL` must already be set (they were added in prior builds). If any is missing, stop — this is an environmental issue, not a build issue.

- [ ] **P4: Confirm required shadcn primitives are absent**

```bash
ls src/components/ui/ | grep -E "^(switch|label)\.tsx$"
```
Expected: empty output. The plan adds these in Task 7.

---

## Task 1: Install dependencies and add env vars

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.env.local` (manual — not committed)

- [ ] **Step 1: Install Stripe SDKs**

```bash
npm install stripe
npm install @stripe/stripe-js
```
Expected: `package.json` gains `"stripe": "^<latest>"` and `"@stripe/stripe-js": "^<latest>"` under `dependencies`. `package-lock.json` updates.

- [ ] **Step 2: Generate connect-state secret and add to `.env.local`**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the 64-char hex output. Add these lines to `.env.local`:

```
STRIPE_CONNECT_STATE_SECRET=<paste the 64-char hex here>
STRIPE_CONNECT_CLIENT_ID=ca_<get from Stripe dashboard → Settings → Connect settings; use test-mode value>
```

**Note:** `STRIPE_CONNECT_CLIENT_ID` is not a secret (it appears in the OAuth redirect URL) but kept in env for easy environment switching. Do NOT add `STRIPE_SECRET_KEY` or `STRIPE_PUBLISHABLE_KEY` to env — those live encrypted in the `stripe_connection` row per SaaS Readiness Principle 3.

- [ ] **Step 3: Update `.env.example`**

Read the file, then append:

```
# Stripe OAuth — Build 17a
# Signs the short-lived OAuth state param during /settings/stripe connect flow.
STRIPE_CONNECT_STATE_SECRET=
# Your Stripe Connect platform client ID (ca_...). Not secret — appears in redirect URL.
STRIPE_CONNECT_CLIENT_ID=
```

- [ ] **Step 4: Verify tsc still passes (no code changes yet, just deps)**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "feat(17a): install stripe SDKs and document connect env vars"
```

---

## Task 2: Database migration (`migration-build39-stripe-payments.sql`)

**Files:**
- Create: `supabase/migration-build39-stripe-payments.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migration-build39-stripe-payments.sql` with the following content (all in one file, in this order — table creation first, then alters, then indexes, then RLS, then grants):

```sql
-- Build 17a — Stripe Connection & Payment Requests
-- Creates single-row stripe_connection (encrypted credentials), payment_requests
-- (each online payment attempt), and stripe_events (webhook idempotency log,
-- populated in Build 17c). Adds flag columns to invoices and jobs.

-- ---------------------------------------------------------------------------
-- stripe_connection: one row expected. Upsert pattern is delete-then-insert.
-- ---------------------------------------------------------------------------
create table if not exists stripe_connection (
  id uuid primary key default gen_random_uuid(),
  stripe_account_id text not null,
  publishable_key text not null,
  secret_key_encrypted text not null,
  webhook_signing_secret_encrypted text,
  mode text not null default 'test' check (mode in ('test','live')),
  ach_enabled boolean not null default true,
  card_enabled boolean not null default true,
  pass_card_fee_to_customer boolean not null default false,
  card_fee_percent numeric(5,2) not null default 3.00 check (card_fee_percent >= 0 and card_fee_percent <= 5),
  ach_preferred_threshold numeric(10,2),
  default_statement_descriptor text,
  surcharge_disclosure text,
  last_connected_at timestamptz,
  connected_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_connection_payment_method_at_least_one
    check (ach_enabled = true or card_enabled = true)
);

-- ---------------------------------------------------------------------------
-- payment_requests: one row per Checkout Session we create.
-- ---------------------------------------------------------------------------
create table if not exists payment_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  request_type text not null check (request_type in ('invoice','deposit','retainer','partial')),
  title text not null,
  amount numeric(10,2) not null check (amount > 0),
  card_fee_amount numeric(10,2),
  total_charged numeric(10,2),
  status text not null default 'draft' check (
    status in ('draft','sent','viewed','paid','failed','refunded','partially_refunded','expired','voided')
  ),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  payment_method_type text check (payment_method_type in ('card','us_bank_account')),
  link_token text unique,
  link_expires_at timestamptz,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  paid_at timestamptz,
  payer_email text,
  payer_name text,
  receipt_pdf_path text,
  reminder_count integer not null default 0,
  next_reminder_at timestamptz,
  voided_at timestamptz,
  voided_by uuid references user_profiles(id),
  void_reason text,
  sent_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payment_requests_job_id on payment_requests(job_id);
create index if not exists idx_payment_requests_invoice_id on payment_requests(invoice_id);
create index if not exists idx_payment_requests_status on payment_requests(status);
create index if not exists idx_payment_requests_link_token on payment_requests(link_token);
create index if not exists idx_payment_requests_next_reminder_at
  on payment_requests(next_reminder_at) where next_reminder_at is not null;

-- ---------------------------------------------------------------------------
-- stripe_events: webhook idempotency log. Populated in Build 17c.
-- Creating now keeps migrations sequential.
-- ---------------------------------------------------------------------------
create table if not exists stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  event_type text not null,
  livemode boolean,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  payment_request_id uuid references payment_requests(id) on delete set null,
  received_at timestamptz not null default now()
);

create index if not exists idx_stripe_events_event_type on stripe_events(event_type);
create index if not exists idx_stripe_events_payment_request_id on stripe_events(payment_request_id);

-- ---------------------------------------------------------------------------
-- Alter existing tables.
-- ---------------------------------------------------------------------------
alter table invoices add column if not exists has_payment_request boolean not null default false;
alter table invoices add column if not exists stripe_balance_remaining numeric(10,2);
alter table jobs add column if not exists has_pending_payment_request boolean not null default false;

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse the shared function if it exists; otherwise inline).
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_stripe_connection_updated_at on stripe_connection;
create trigger trg_stripe_connection_updated_at
  before update on stripe_connection
  for each row execute function set_updated_at();

drop trigger if exists trg_payment_requests_updated_at on payment_requests;
create trigger trg_payment_requests_updated_at
  before update on payment_requests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — match existing permissive pattern (service role bypasses; anon-gated
-- routes use service client). Tighten in a later build.
-- ---------------------------------------------------------------------------
alter table stripe_connection enable row level security;
drop policy if exists "Allow all on stripe_connection" on stripe_connection;
create policy "Allow all on stripe_connection" on stripe_connection
  for all using (true) with check (true);

alter table payment_requests enable row level security;
drop policy if exists "Allow all on payment_requests" on payment_requests;
create policy "Allow all on payment_requests" on payment_requests
  for all using (true) with check (true);

alter table stripe_events enable row level security;
drop policy if exists "Allow all on stripe_events" on stripe_events;
create policy "Allow all on stripe_events" on stripe_events
  for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Grants — match email_accounts pattern (anon + authenticated + service_role).
-- ---------------------------------------------------------------------------
grant all on stripe_connection to anon, authenticated, service_role;
grant all on payment_requests  to anon, authenticated, service_role;
grant all on stripe_events     to anon, authenticated, service_role;
```

- [ ] **Step 2: Apply the migration**

Apply against Supabase via the dashboard SQL editor (shared project — dev = prod per memory). Paste the file contents into a new SQL query and run.

Verify success by running:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name in ('stripe_connection','payment_requests','stripe_events')
order by table_name, ordinal_position;
```

Expected: rows match the DDL. Also verify the new columns on `invoices` and `jobs`:

```sql
select column_name, data_type
from information_schema.columns
where (table_name='invoices' and column_name in ('has_payment_request','stripe_balance_remaining'))
   or (table_name='jobs' and column_name='has_pending_payment_request');
```

Expected: three rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration-build39-stripe-payments.sql
git commit -m "feat(17a): migration — stripe_connection, payment_requests, stripe_events + invoice/job flags"
```

---

## Task 3: Stripe client library

**Files:**
- Create: `src/lib/stripe.ts`

- [ ] **Step 1: Write the module**

Create `src/lib/stripe.ts`:

```ts
import Stripe from "stripe";
import { decrypt } from "@/lib/encryption";
import { createServiceClient } from "@/lib/supabase-api";

export class StripeNotConnectedError extends Error {
  constructor() {
    super("No Stripe connection configured. Connect at /settings/stripe.");
    this.name = "StripeNotConnectedError";
  }
}

export interface StripeConnectionRow {
  id: string;
  stripe_account_id: string;
  publishable_key: string;
  secret_key_encrypted: string;
  webhook_signing_secret_encrypted: string | null;
  mode: "test" | "live";
  ach_enabled: boolean;
  card_enabled: boolean;
  pass_card_fee_to_customer: boolean;
  card_fee_percent: number;
  ach_preferred_threshold: number | null;
  default_statement_descriptor: string | null;
  surcharge_disclosure: string | null;
  last_connected_at: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function loadStripeConnection(): Promise<StripeConnectionRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("stripe_connection")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as StripeConnectionRow | null) ?? null;
}

let cachedClient: { accountId: string; client: Stripe } | null = null;

export async function getStripeClient(): Promise<{ client: Stripe; connection: StripeConnectionRow }> {
  const connection = await loadStripeConnection();
  if (!connection) throw new StripeNotConnectedError();
  if (cachedClient && cachedClient.accountId === connection.stripe_account_id) {
    return { client: cachedClient.client, connection };
  }
  const secret = decrypt(connection.secret_key_encrypted);
  const client = new Stripe(secret, {
    apiVersion: "2024-12-18.acacia",
    typescript: true,
    appInfo: { name: "aaa-platform", version: "17a" },
  });
  cachedClient = { accountId: connection.stripe_account_id, client };
  return { client, connection };
}

export async function getPublicKey(): Promise<string> {
  const connection = await loadStripeConnection();
  if (!connection) throw new StripeNotConnectedError();
  return connection.publishable_key;
}
```

**Notes:**
- `apiVersion` pin: use the Stripe SDK's current pinned version at install time — if the SDK complains, copy the literal it suggests. Do not use `"latest"`.
- `cachedClient` is module-scoped and invalidated when the account ID changes (e.g. after disconnect → reconnect).
- `getServiceClient` already exists per `src/lib/supabase/service.ts` (used by b45be07 invoice-email fix). If the export name differs, adjust the import — confirm by reading the file before writing this one.

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stripe.ts
git commit -m "feat(17a): stripe client wrapper with encrypted secret loading"
```

---

## Task 4: OAuth state helper

**Files:**
- Create: `src/lib/stripe-oauth.ts`

- [ ] **Step 1: Write the module**

```ts
import { createHmac, timingSafeEqual, randomBytes } from "crypto";

const MAX_AGE_SECONDS = 10 * 60; // 10 minutes

export class InvalidOAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOAuthStateError";
  }
}

interface StatePayload {
  user_id: string;
  nonce: string;
  iat: number;
}

function getSecret(): Buffer {
  const s = process.env.STRIPE_CONNECT_STATE_SECRET;
  if (!s) throw new Error("STRIPE_CONNECT_STATE_SECRET is not set");
  if (s.length < 32) throw new Error("STRIPE_CONNECT_STATE_SECRET must be at least 32 hex chars");
  return Buffer.from(s, "utf8");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = 4 - (s.length % 4 || 4);
  return Buffer.from(
    (s + "=".repeat(pad === 4 ? 0 : pad)).replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
}

export function signOAuthState(userId: string): string {
  const payload: StatePayload = {
    user_id: userId,
    nonce: randomBytes(16).toString("hex"),
    iat: Math.floor(Date.now() / 1000),
  };
  const encoded = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", getSecret()).update(encoded).digest());
  return `${encoded}.${sig}`;
}

export function verifyOAuthState(state: string): StatePayload {
  const parts = state.split(".");
  if (parts.length !== 2) throw new InvalidOAuthStateError("Malformed state");
  const [encoded, sig] = parts;
  const expected = createHmac("sha256", getSecret()).update(encoded).digest();
  const provided = b64urlDecode(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new InvalidOAuthStateError("Signature mismatch");
  }
  let payload: StatePayload;
  try {
    payload = JSON.parse(b64urlDecode(encoded).toString("utf8")) as StatePayload;
  } catch {
    throw new InvalidOAuthStateError("Malformed payload");
  }
  if (!payload.user_id || !payload.nonce || !payload.iat) {
    throw new InvalidOAuthStateError("Missing claims");
  }
  const age = Math.floor(Date.now() / 1000) - payload.iat;
  if (age < 0 || age > MAX_AGE_SECONDS) throw new InvalidOAuthStateError("State expired");
  return payload;
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stripe-oauth.ts
git commit -m "feat(17a): signed OAuth state helper for stripe connect flow"
```

---

## Task 5: Payment-link token helper

**Files:**
- Create: `src/lib/payment-link-tokens.ts`

- [ ] **Step 1: Write the module** (mirrors `src/lib/contracts/tokens.ts` but with a payment-request payload shape)

```ts
import { createHmac, timingSafeEqual } from "crypto";

export class InvalidPaymentLinkTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPaymentLinkTokenError";
  }
}

export interface PaymentLinkTokenPayload {
  payment_request_id: string;
  job_id: string;
  iat: number;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  const pad = 4 - (s.length % 4 || 4);
  return Buffer.from(
    (s + "=".repeat(pad === 4 ? 0 : pad)).replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
}
function getSecret(): Buffer {
  const s = process.env.SIGNING_LINK_SECRET;
  if (!s) throw new Error("SIGNING_LINK_SECRET is not set");
  if (s.length < 32) throw new Error("SIGNING_LINK_SECRET must be at least 32 characters");
  return Buffer.from(s, "utf8");
}

export interface GeneratePaymentLinkTokenInput {
  paymentRequestId: string;
  jobId: string;
  expiresAt: Date;
}

export function generatePaymentLinkToken({
  paymentRequestId,
  jobId,
  expiresAt,
}: GeneratePaymentLinkTokenInput): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        payment_request_id: paymentRequestId,
        job_id: jobId,
        iat: now,
        exp,
      } satisfies PaymentLinkTokenPayload),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const sig = b64url(createHmac("sha256", getSecret()).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

export function verifyPaymentLinkToken(token: string): PaymentLinkTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new InvalidPaymentLinkTokenError("Malformed token");
  const [header, payload, sig] = parts;
  const expected = createHmac("sha256", getSecret()).update(`${header}.${payload}`).digest();
  const provided = b64urlDecode(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new InvalidPaymentLinkTokenError("Signature mismatch");
  }
  let parsed: PaymentLinkTokenPayload;
  try {
    parsed = JSON.parse(b64urlDecode(payload).toString("utf8")) as PaymentLinkTokenPayload;
  } catch {
    throw new InvalidPaymentLinkTokenError("Malformed payload");
  }
  if (!parsed.payment_request_id || !parsed.job_id || !parsed.exp) {
    throw new InvalidPaymentLinkTokenError("Missing claims");
  }
  if (Math.floor(Date.now() / 1000) >= parsed.exp) {
    throw new InvalidPaymentLinkTokenError("Token expired");
  }
  return parsed;
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/payment-link-tokens.ts
git commit -m "feat(17a): payment-link JWT helper reusing SIGNING_LINK_SECRET"
```

---

## Task 6: Extend the auth gate to support permission-keyed checks

**Context:** Existing routes use `createServerSupabaseClient()` from `src/lib/supabase-server` plus `requireAdmin(supabase)` from `src/lib/qb/auth.ts`, which returns `{ ok: true; userId }` or `{ ok: false; response }`. Build 17a needs the same shape but keyed on a specific permission (`access_settings`, `view_billing`, `record_payments`). Admins still bypass.

**Files:**
- Create: `src/lib/permissions-api.ts`

- [ ] **Step 1: Write the helper**

```ts
// Shared route gate that authorizes by permission key. Admins always pass.
// Mirrors the shape of requireAdmin() in src/lib/qb/auth.ts so the call site
// looks identical: `if (!gate.ok) return gate.response;`

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RequirePermissionResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function requirePermission(
  supabase: SupabaseClient,
  key: string,
): Promise<RequirePermissionResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "not authenticated" }, { status: 401 }),
    };
  }
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  if (profile?.role === "admin") {
    return { ok: true, userId: user.id };
  }
  const { data: perm } = await supabase
    .from("user_permissions")
    .select("granted")
    .eq("user_id", user.id)
    .eq("permission_key", key)
    .maybeSingle<{ granted: boolean }>();
  if (perm?.granted === true) {
    return { ok: true, userId: user.id };
  }
  return {
    ok: false,
    response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
  };
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/permissions-api.ts
git commit -m "feat(17a): permission-keyed route gate mirroring requireAdmin shape"
```

---

## Task 7: Add missing shadcn primitives (Switch, Label)

**Files:**
- Create: `src/components/ui/switch.tsx`
- Create: `src/components/ui/label.tsx`

- [ ] **Step 1: Install Radix primitives**

```bash
npm install @radix-ui/react-switch @radix-ui/react-label
```

- [ ] **Step 2: Add `src/components/ui/label.tsx`** (standard shadcn/ui source)

```tsx
"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
```

- [ ] **Step 3: Add `src/components/ui/switch.tsx`** (standard shadcn/ui source)

```tsx
"use client";

import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
        "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
```

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/ui/switch.tsx src/components/ui/label.tsx
git commit -m "feat(17a): add shadcn Switch and Label primitives"
```

---

## Task 8: `/api/stripe/connect/start` and `/api/stripe/connect/callback`

**Files:**
- Create: `src/app/api/stripe/connect/start/route.ts`
- Create: `src/app/api/stripe/connect/callback/route.ts`

**Auth pattern used:** `createServerSupabaseClient()` from `@/lib/supabase-server` → `requirePermission(supabase, "access_settings")` from the helper added in Task 6.

- [ ] **Step 1: Write `connect/start/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { signOAuthState } from "@/lib/stripe-oauth";
import { requirePermission } from "@/lib/permissions-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(_req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "access_settings");
  if (!gate.ok) return gate.response;

  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId) {
    return NextResponse.json({ error: "STRIPE_CONNECT_CLIENT_ID not set" }, { status: 500 });
  }
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL not set" }, { status: 500 });
  }

  const state = signOAuthState(gate.userId);
  const redirectUri = `${appUrl}/api/stripe/connect/callback`;
  const oauthUrl = new URL("https://connect.stripe.com/oauth/authorize");
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("client_id", clientId);
  oauthUrl.searchParams.set("scope", "read_write");
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("state", state);
  oauthUrl.searchParams.set("stripe_user[business_type]", "company");

  return NextResponse.redirect(oauthUrl.toString(), { status: 303 });
}
```

- [ ] **Step 2: Write `connect/callback/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { verifyOAuthState, InvalidOAuthStateError } from "@/lib/stripe-oauth";
import { createServiceClient } from "@/lib/supabase-api";
import { encrypt } from "@/lib/encryption";

interface StripeOAuthTokenResponse {
  stripe_user_id: string;
  stripe_publishable_key: string;
  access_token: string;
  livemode: boolean;
  scope: string;
  error?: string;
  error_description?: string;
}

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const back = (msg: string) => {
    const dest = new URL(`${appUrl}/settings/stripe`);
    dest.searchParams.set("connect_error", msg);
    return NextResponse.redirect(dest.toString(), { status: 303 });
  };

  if (errorParam) return back(errorParam);
  if (!code || !stateParam) return back("missing_params");

  let payload;
  try {
    payload = verifyOAuthState(stateParam);
  } catch (e) {
    if (e instanceof InvalidOAuthStateError) return back("invalid_state");
    throw e;
  }

  const stripeSecretBootstrap = process.env.STRIPE_CONNECT_CLIENT_SECRET;
  // NOTE: Stripe requires the platform's live secret key for code exchange.
  // Since our architecture stores no platform-wide STRIPE_SECRET_KEY in env,
  // this is the one exception: a short-lived env var used only for OAuth
  // token exchange. Add STRIPE_CONNECT_CLIENT_SECRET to .env.local + Vercel.
  if (!stripeSecretBootstrap) {
    return back("platform_secret_missing");
  }

  const tokenRes = await fetch("https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_secret: stripeSecretBootstrap,
      code,
      grant_type: "authorization_code",
    }),
  });
  const token = (await tokenRes.json()) as StripeOAuthTokenResponse;
  if (!tokenRes.ok || token.error) {
    return back(token.error ?? "token_exchange_failed");
  }

  const supabase = createServiceClient();
  // Single-row pattern: delete existing, insert fresh.
  await supabase.from("stripe_connection").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  const { error: insertErr } = await supabase.from("stripe_connection").insert({
    stripe_account_id: token.stripe_user_id,
    publishable_key: token.stripe_publishable_key,
    secret_key_encrypted: encrypt(token.access_token),
    mode: token.livemode ? "live" : "test",
    last_connected_at: new Date().toISOString(),
    connected_by: payload.user_id,
  });
  if (insertErr) return back("db_insert_failed");

  const dest = new URL(`${appUrl}/settings/stripe`);
  dest.searchParams.set("connected", "1");
  return NextResponse.redirect(dest.toString(), { status: 303 });
}
```

**IMPORTANT — plan deviation from spec Part 2:** The spec says "Do NOT add `STRIPE_SECRET_KEY` to `.env`." Strictly, we need `STRIPE_CONNECT_CLIENT_SECRET` (the platform's live secret key) to exchange the OAuth code for an access token — this is Stripe's required API behavior, not optional. It is the platform's key, not any individual connected account's key. Document this env var in `.env.example` and add it during Task 8. If the user reviews this plan and disagrees, the alternative is to use Stripe's `/v1/account` API with the platform key, which still requires the same env var.

- [ ] **Step 3: Add `STRIPE_CONNECT_CLIENT_SECRET` to `.env.example`**

Append to `.env.example`:

```
# Platform secret key used ONLY for OAuth code exchange during connect flow.
# Not used for any per-tenant operation — tenant keys live encrypted in stripe_connection.
STRIPE_CONNECT_CLIENT_SECRET=
```

And add it to `.env.local` with the platform's Stripe test-mode secret key.

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/stripe/connect/ .env.example
git commit -m "feat(17a): stripe connect start + callback routes with signed state"
```

---

## Task 9: `/api/stripe/disconnect` and `/api/stripe/settings`

**Files:**
- Create: `src/app/api/stripe/disconnect/route.ts`
- Create: `src/app/api/stripe/settings/route.ts`

- [ ] **Step 1: Write `disconnect/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";

export async function POST(_req: NextRequest) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "access_settings");
  if (!gate.ok) return gate.response;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("stripe_connection")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

**Note:** We intentionally do NOT delete `payment_requests` or `stripe_events` rows — historical records survive a disconnect.

- [ ] **Step 2: Write `settings/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";

interface SettingsPatch {
  ach_enabled?: boolean;
  card_enabled?: boolean;
  pass_card_fee_to_customer?: boolean;
  card_fee_percent?: number;
  ach_preferred_threshold?: number | null;
  default_statement_descriptor?: string | null;
  surcharge_disclosure?: string | null;
}

const ALLOWED: (keyof SettingsPatch)[] = [
  "ach_enabled",
  "card_enabled",
  "pass_card_fee_to_customer",
  "card_fee_percent",
  "ach_preferred_threshold",
  "default_statement_descriptor",
  "surcharge_disclosure",
];

export async function GET() {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "access_settings");
  if (!gate.ok) return gate.response;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("stripe_connection")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: data });
}

export async function PATCH(req: NextRequest) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "access_settings");
  if (!gate.ok) return gate.response;

  const body = (await req.json()) as SettingsPatch;
  const patch: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      patch[key] = body[key];
    }
  }

  // Validation
  if (patch.default_statement_descriptor && typeof patch.default_statement_descriptor === "string") {
    if ((patch.default_statement_descriptor as string).length > 22) {
      return NextResponse.json({ error: "descriptor_too_long" }, { status: 400 });
    }
  }
  if (typeof patch.card_fee_percent === "number") {
    if (patch.card_fee_percent < 0 || patch.card_fee_percent > 5) {
      return NextResponse.json({ error: "fee_out_of_range" }, { status: 400 });
    }
  }
  if (patch.ach_enabled === false && patch.card_enabled === false) {
    return NextResponse.json({ error: "at_least_one_method_required" }, { status: 400 });
  }
  // Defensive: if only one toggle is being set to false, re-check current state.
  if (patch.ach_enabled === false || patch.card_enabled === false) {
    const supabase = createServiceClient();
    const { data: cur } = await supabase
      .from("stripe_connection")
      .select("ach_enabled, card_enabled")
      .limit(1)
      .maybeSingle();
    if (cur) {
      const nextAch = patch.ach_enabled ?? cur.ach_enabled;
      const nextCard = patch.card_enabled ?? cur.card_enabled;
      if (!nextAch && !nextCard) {
        return NextResponse.json({ error: "at_least_one_method_required" }, { status: 400 });
      }
    }
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("stripe_connection")
    .update(patch)
    .neq("id", "00000000-0000-0000-0000-000000000000")
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: data });
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/stripe/disconnect/ src/app/api/stripe/settings/
git commit -m "feat(17a): stripe disconnect + settings PATCH routes"
```

---

## Task 10: `POST /api/payment-requests`

**Files:**
- Create: `src/app/api/payment-requests/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getStripeClient, StripeNotConnectedError } from "@/lib/stripe";
import { generatePaymentLinkToken } from "@/lib/payment-link-tokens";

interface CreateBody {
  job_id: string;
  invoice_id?: string | null;
  request_type: "invoice" | "deposit" | "retainer" | "partial";
  title: string;
  amount: number;
  link_expiry_days?: number;
  allow_card?: boolean;
  allow_ach?: boolean;
}

const DEFAULT_EXPIRY_DAYS = 14;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export async function POST(req: NextRequest) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "record_payments");
  if (!gate.ok) return gate.response;

  const body = (await req.json()) as CreateBody;

  if (!body.job_id || !body.title || typeof body.amount !== "number" || body.amount <= 0) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const validTypes: CreateBody["request_type"][] = ["invoice", "deposit", "retainer", "partial"];
  if (!validTypes.includes(body.request_type)) {
    return NextResponse.json({ error: "invalid_request_type" }, { status: 400 });
  }

  let stripeCtx: Awaited<ReturnType<typeof getStripeClient>>;
  try {
    stripeCtx = await getStripeClient();
  } catch (e) {
    if (e instanceof StripeNotConnectedError) {
      return NextResponse.json({ error: "stripe_not_connected" }, { status: 400 });
    }
    throw e;
  }
  const { client: stripe, connection } = stripeCtx;

  const supabase = createServiceClient();

  // Verify job exists and fetch contact for customer_email
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, contact_id, job_number")
    .eq("id", body.job_id)
    .maybeSingle();
  if (jobErr || !job) return NextResponse.json({ error: "job_not_found" }, { status: 404 });

  let customerEmail: string | null = null;
  let customerName: string | null = null;
  if (job.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("email, first_name, last_name")
      .eq("id", job.contact_id)
      .maybeSingle();
    if (contact) {
      customerEmail = contact.email ?? null;
      customerName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null;
    }
  }

  // If invoice-scoped, verify invoice belongs to job and amount <= balance
  if (body.invoice_id) {
    const { data: invoice } = await supabase
      .from("invoices")
      .select("id, job_id, total_amount")
      .eq("id", body.invoice_id)
      .maybeSingle();
    if (!invoice) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
    if (invoice.job_id !== body.job_id) {
      return NextResponse.json({ error: "invoice_job_mismatch" }, { status: 400 });
    }
    // Compute balance: total_amount - sum(payments where status='received' for this invoice).
    const { data: payments } = await supabase
      .from("payments")
      .select("amount, status")
      .eq("invoice_id", body.invoice_id);
    const paid = (payments ?? [])
      .filter((p) => p.status === "received")
      .reduce((acc, p) => acc + Number(p.amount), 0);
    const balance = Number(invoice.total_amount) - paid;
    if (body.amount > balance + 0.005) {
      return NextResponse.json({ error: "amount_exceeds_balance" }, { status: 400 });
    }
  }

  // Apply ACH-preferred-threshold
  let allowCard = body.allow_card ?? connection.card_enabled;
  let allowAch = body.allow_ach ?? connection.ach_enabled;
  if (
    connection.ach_preferred_threshold != null &&
    body.amount >= Number(connection.ach_preferred_threshold) &&
    connection.ach_enabled
  ) {
    allowCard = false;
  }
  if (!allowCard && !allowAch) {
    return NextResponse.json({ error: "no_payment_methods_available" }, { status: 400 });
  }

  const paymentMethodTypes: string[] = [];
  if (allowCard && connection.card_enabled) paymentMethodTypes.push("card");
  if (allowAch && connection.ach_enabled) paymentMethodTypes.push("us_bank_account");

  // Pre-generate payment_request id so we can stamp it into the token
  const paymentRequestId = crypto.randomUUID();
  const expiryDays = body.link_expiry_days ?? DEFAULT_EXPIRY_DAYS;
  const linkExpiresAt = addDays(new Date(), expiryDays);
  const token = generatePaymentLinkToken({
    paymentRequestId,
    jobId: body.job_id,
    expiresAt: linkExpiresAt,
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: paymentMethodTypes as (
      | "card"
      | "us_bank_account"
    )[],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          product_data: { name: body.title },
          unit_amount: Math.round(body.amount * 100),
        },
      },
    ],
    metadata: {
      payment_request_id: paymentRequestId,
      job_id: body.job_id,
      invoice_id: body.invoice_id ?? "",
      request_type: body.request_type,
    },
    payment_intent_data: {
      metadata: {
        payment_request_id: paymentRequestId,
        job_id: body.job_id,
        invoice_id: body.invoice_id ?? "",
        request_type: body.request_type,
      },
      statement_descriptor_suffix: connection.default_statement_descriptor?.slice(0, 22) || undefined,
    },
    customer_email: customerEmail ?? undefined,
    success_url: `${appUrl}/pay/${token}/success`,
    cancel_url: `${appUrl}/pay/${token}`,
    expires_at: Math.floor(linkExpiresAt.getTime() / 1000),
  });

  const { data: inserted, error: insertErr } = await supabase
    .from("payment_requests")
    .insert({
      id: paymentRequestId,
      job_id: body.job_id,
      invoice_id: body.invoice_id ?? null,
      request_type: body.request_type,
      title: body.title,
      amount: body.amount,
      status: "draft",
      stripe_checkout_session_id: session.id,
      link_token: token,
      link_expires_at: linkExpiresAt.toISOString(),
      payer_email: customerEmail,
      payer_name: customerName,
      sent_by: gate.userId,
    })
    .select("*")
    .maybeSingle();
  if (insertErr) {
    // Best-effort: expire the session we just created so it doesn't dangle.
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch {
      /* ignore */
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Flip convenience flags on parent rows
  await supabase.from("jobs").update({ has_pending_payment_request: true }).eq("id", body.job_id);
  if (body.invoice_id) {
    await supabase
      .from("invoices")
      .update({ has_payment_request: true })
      .eq("id", body.invoice_id);
  }

  return NextResponse.json({ payment_request: inserted });
}

export async function GET(req: NextRequest) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "view_billing");
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const jobId = url.searchParams.get("job_id");
  if (!jobId) return NextResponse.json({ error: "job_id_required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payment_requests: data });
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/payment-requests/route.ts
git commit -m "feat(17a): POST/GET /api/payment-requests — creates stripe checkout session and db row"
```

---

## Task 11: `GET /api/payment-requests/[id]` and `POST .../void`

**Files:**
- Create: `src/app/api/payment-requests/[id]/route.ts`
- Create: `src/app/api/payment-requests/[id]/void/route.ts`

- [ ] **Step 1: Write `[id]/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "view_billing");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ payment_request: data });
}
```

- [ ] **Step 2: Write `[id]/void/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getStripeClient } from "@/lib/stripe";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "record_payments");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: string };

  const supabase = createServiceClient();
  const { data: pr, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pr) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (pr.status === "paid") {
    return NextResponse.json({ error: "cannot_void_paid" }, { status: 400 });
  }
  if (pr.status === "voided") {
    return NextResponse.json({ payment_request: pr });
  }

  if (pr.stripe_checkout_session_id) {
    try {
      const { client } = await getStripeClient();
      await client.checkout.sessions.expire(pr.stripe_checkout_session_id);
    } catch {
      // Session may already be expired — swallow and proceed.
    }
  }

  const { data: updated, error: updErr } = await supabase
    .from("payment_requests")
    .update({
      status: "voided",
      voided_at: new Date().toISOString(),
      voided_by: gate.userId,
      void_reason: body.reason ?? null,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Recompute parent flags.
  const { data: remainingForJob } = await supabase
    .from("payment_requests")
    .select("id, status")
    .eq("job_id", pr.job_id)
    .in("status", ["draft", "sent", "viewed"]);
  const jobStillPending = (remainingForJob ?? []).length > 0;
  await supabase
    .from("jobs")
    .update({ has_pending_payment_request: jobStillPending })
    .eq("id", pr.job_id);

  if (pr.invoice_id) {
    const { data: remainingForInvoice } = await supabase
      .from("payment_requests")
      .select("id, status")
      .eq("invoice_id", pr.invoice_id)
      .not("status", "in", "(voided,expired,failed,refunded)");
    const invoiceStillLinked = (remainingForInvoice ?? []).length > 0;
    await supabase
      .from("invoices")
      .update({ has_payment_request: invoiceStillLinked })
      .eq("id", pr.invoice_id);
  }

  return NextResponse.json({ payment_request: updated });
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/payment-requests/\[id\]/
git commit -m "feat(17a): payment-request detail + void routes"
```

---

## Task 12: Insert "Stripe Payments" in the settings sidebar

**Files:**
- Modify: `src/lib/settings-nav.ts`

- [ ] **Step 1: Edit the nav items array**

Current lines 44-45:
```ts
  { href: "/settings/accounting", label: "Accounting", icon: Link2 },
  { href: "/settings/reports", label: "Reports", icon: FileText },
```

Update the icon import on line 2 to add `CreditCard`:
```ts
import {
  Building2,
  Palette,
  ListChecks,
  Flame,
  Store,
  Receipt,
  Users,
  Mail,
  FileSignature,
  ClipboardList,
  Bell,
  FileText,
  Download,
  BookOpen,
  Menu,
  Send,
  Link2,
  CreditCard,
} from "lucide-react";
```

Insert a new entry between lines 44 and 45:
```ts
  { href: "/settings/accounting", label: "Accounting", icon: Link2 },
  { href: "/settings/stripe", label: "Stripe Payments", icon: CreditCard },
  { href: "/settings/reports", label: "Reports", icon: FileText },
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings-nav.ts
git commit -m "feat(17a): add stripe payments settings nav item"
```

---

## Task 13: `/settings/stripe` server component + disconnected state

**Files:**
- Create: `src/app/settings/stripe/page.tsx`
- Create: `src/app/settings/stripe/stripe-settings-client.tsx`

- [ ] **Step 1: Write `page.tsx` (server)**

```tsx
import { loadStripeConnection } from "@/lib/stripe";
import StripeSettingsClient from "./stripe-settings-client";

export const dynamic = "force-dynamic";

export default async function StripeSettingsPage() {
  const connection = await loadStripeConnection();
  return <StripeSettingsClient initialConnection={connection} />;
}
```

- [ ] **Step 2: Write `stripe-settings-client.tsx` (disconnected state only — this step)**

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import type { StripeConnectionRow } from "@/lib/stripe";

interface Props {
  initialConnection: StripeConnectionRow | null;
}

export default function StripeSettingsClient({ initialConnection }: Props) {
  const [connection] = useState<StripeConnectionRow | null>(initialConnection);

  const onConnect = () => {
    // POST redirects (303) — do a form-like navigation instead of fetch so the
    // browser follows the Stripe OAuth redirect.
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/stripe/connect/start";
    document.body.appendChild(form);
    form.submit();
  };

  if (!connection) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Stripe Payments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-muted-foreground">
              Connect your Stripe account to accept online card and ACH payments for invoices
              and deposits. Credentials are stored encrypted in your database — never in
              configuration files.
            </p>
            <Button onClick={onConnect} size="lg">
              Connect Stripe Account
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Connected-state UI lands in Task 14.
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Stripe Payments</CardTitle>
        </CardHeader>
        <CardContent>Connected to {connection.stripe_account_id}</CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Verify preview**

```bash
# preview_start if not running, then navigate to /settings/stripe
```

Open `/settings/stripe` in the preview. With no row in `stripe_connection`, you should see the "Connect Stripe Account" card. Clicking the button should post to `/api/stripe/connect/start` and (assuming `STRIPE_CONNECT_CLIENT_ID` is set) redirect to Stripe.

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/stripe/
git commit -m "feat(17a): /settings/stripe page with disconnected state"
```

---

## Task 14: Connected-state UI — status card and statement descriptor

**Files:**
- Modify: `src/app/settings/stripe/stripe-settings-client.tsx`

- [ ] **Step 1: Extend the client component**

Replace the stub "Connected to X" block with:

```tsx
"use client";

import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreditCard, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StripeConnectionRow } from "@/lib/stripe";

interface Props {
  initialConnection: StripeConnectionRow | null;
}

function useDebouncedPatch(setConnection: (c: StripeConnectionRow | null) => void) {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  return useCallback(
    (field: string, value: unknown, delay = 600) => {
      const existing = timers.current.get(field);
      if (existing) clearTimeout(existing);
      const t = setTimeout(async () => {
        timers.current.delete(field);
        const res = await fetch("/api/stripe/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        });
        if (!res.ok) {
          const { error } = (await res.json()) as { error?: string };
          toast.error(error ?? "Failed to save");
          return;
        }
        const { connection } = (await res.json()) as { connection: StripeConnectionRow };
        setConnection(connection);
        toast.success("Saved");
      }, delay);
      timers.current.set(field, t);
    },
    [setConnection],
  );
}

export default function StripeSettingsClient({ initialConnection }: Props) {
  const [connection, setConnection] = useState<StripeConnectionRow | null>(initialConnection);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const patch = useDebouncedPatch(setConnection);

  const onConnect = () => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/stripe/connect/start";
    document.body.appendChild(form);
    form.submit();
  };

  const onDisconnect = async () => {
    const res = await fetch("/api/stripe/disconnect", { method: "POST" });
    if (!res.ok) {
      toast.error("Failed to disconnect");
      return;
    }
    setConnection(null);
    setDisconnectOpen(false);
    toast.success("Disconnected");
  };

  const onCopyAccountId = async () => {
    if (!connection) return;
    await navigator.clipboard.writeText(connection.stripe_account_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!connection) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Stripe Payments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-muted-foreground">
              Connect your Stripe account to accept online card and ACH payments for
              invoices and deposits. Credentials are stored encrypted in your database —
              never in configuration files.
            </p>
            <Button onClick={onConnect} size="lg">
              Connect Stripe Account
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const truncatedAccount = `${connection.stripe_account_id.slice(0, 10)}…${connection.stripe_account_id.slice(-4)}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Stripe Payments
            <Badge
              variant={connection.mode === "live" ? "default" : "secondary"}
              className={connection.mode === "live" ? "" : "bg-amber-500/20 text-amber-700 dark:text-amber-300"}
            >
              {connection.mode === "live" ? "Live" : "Test"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm text-muted-foreground">Stripe account</div>
              <div className="flex items-center gap-2 font-mono text-sm">
                <span>{truncatedAccount}</span>
                <Button variant="ghost" size="icon" onClick={onCopyAccountId}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
              Disconnect
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="descriptor">Statement descriptor</Label>
            <Input
              id="descriptor"
              defaultValue={connection.default_statement_descriptor ?? ""}
              maxLength={22}
              placeholder="e.g. AAA CONTRACTING"
              onChange={(e) =>
                patch("default_statement_descriptor", e.target.value.slice(0, 22) || null)
              }
            />
            <p className="text-xs text-muted-foreground">
              Up to 22 characters. Appears on your customers’ bank statements.
            </p>
          </div>

          {connection.last_connected_at && (
            <p className="text-sm text-muted-foreground">
              Connected{" "}
              {formatDistanceToNow(new Date(connection.last_connected_at), { addSuffix: true })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Payment-method toggles and fee settings land in Task 15. */}

      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Stripe?</DialogTitle>
            <DialogDescription>
              This will clear your encrypted Stripe credentials. Existing payment records are
              preserved. You can reconnect at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDisconnect}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Preview-verify**

Manually insert a test `stripe_connection` row via Supabase SQL editor (if an OAuth test roundtrip isn't available yet):

```sql
insert into stripe_connection
  (stripe_account_id, publishable_key, secret_key_encrypted, mode, last_connected_at)
values
  ('acct_TEST_000000000000', 'pk_test_placeholder', 'ignored:ignored:ignored', 'test', now());
```

Reload `/settings/stripe` — expect:
- Test badge (amber)
- Truncated account ID with copy button
- Statement descriptor input (starts empty)
- Edit descriptor → debounced save → "Saved" toast after 600ms
- Click Disconnect → confirmation dialog → confirm → card returns to "Connect Stripe Account"

Clean up the test row after verifying:
```sql
delete from stripe_connection;
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/stripe/stripe-settings-client.tsx
git commit -m "feat(17a): /settings/stripe connected state — status, descriptor, disconnect"
```

---

## Task 15: Payment-method toggles, surcharge, and ACH threshold

**Files:**
- Modify: `src/app/settings/stripe/stripe-settings-client.tsx`

- [ ] **Step 1: Add the toggles section**

Insert a new `<Card>` immediately after the first card in the connected-state return, and before the `Dialog`:

```tsx
{/* Payment method toggles */}
<Card>
  <CardHeader>
    <CardTitle>Payment methods</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="flex items-center justify-between">
      <div>
        <Label htmlFor="ach_enabled">ACH (US bank) payments</Label>
        <p className="text-xs text-muted-foreground">
          Low fees; typically 0.8% capped at $5. Best for large invoices.
        </p>
      </div>
      <Switch
        id="ach_enabled"
        checked={connection.ach_enabled}
        onCheckedChange={(v) => {
          if (!v && !connection.card_enabled) {
            toast.error("At least one payment method must be enabled");
            return;
          }
          setConnection({ ...connection, ach_enabled: v });
          patch("ach_enabled", v, 50);
        }}
      />
    </div>
    <div className="flex items-center justify-between">
      <div>
        <Label htmlFor="card_enabled">Card payments</Label>
        <p className="text-xs text-muted-foreground">
          Instant; ~2.9% + 30¢ per transaction.
        </p>
      </div>
      <Switch
        id="card_enabled"
        checked={connection.card_enabled}
        onCheckedChange={(v) => {
          if (!v && !connection.ach_enabled) {
            toast.error("At least one payment method must be enabled");
            return;
          }
          setConnection({ ...connection, card_enabled: v });
          patch("card_enabled", v, 50);
        }}
      />
    </div>
  </CardContent>
</Card>

{/* Card surcharge */}
<Card>
  <CardHeader>
    <CardTitle>Card processing fee</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="flex items-center justify-between">
      <div>
        <Label htmlFor="pass_card_fee">Pass card processing fee to customer</Label>
        <p className="text-xs text-muted-foreground">
          Adds a surcharge line on card-paid invoices. Confirm legality in your jurisdiction.
        </p>
      </div>
      <Switch
        id="pass_card_fee"
        checked={connection.pass_card_fee_to_customer}
        onCheckedChange={(v) => {
          setConnection({ ...connection, pass_card_fee_to_customer: v });
          patch("pass_card_fee_to_customer", v, 50);
        }}
      />
    </div>
    {connection.pass_card_fee_to_customer && (
      <>
        <div className="space-y-2">
          <Label htmlFor="card_fee_percent">Surcharge percentage</Label>
          <div className="flex items-center gap-2">
            <Input
              id="card_fee_percent"
              type="number"
              step="0.01"
              min="0"
              max="5"
              defaultValue={connection.card_fee_percent}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0 && v <= 5) {
                  patch("card_fee_percent", v);
                }
              }}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Preview: $1,000 invoice would charge $
            {(1000 + (1000 * Number(connection.card_fee_percent)) / 100).toFixed(2)} on card.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="surcharge_disclosure">Surcharge disclosure</Label>
          <textarea
            id="surcharge_disclosure"
            className="min-h-[80px] w-full rounded-md border border-input bg-background p-2 text-sm"
            defaultValue={
              connection.surcharge_disclosure ??
              "We add a surcharge to card payments that is not greater than our cost of acceptance. We do not surcharge ACH/bank payments."
            }
            onChange={(e) => patch("surcharge_disclosure", e.target.value || null)}
          />
        </div>
      </>
    )}
  </CardContent>
</Card>

{/* ACH threshold */}
<Card>
  <CardHeader>
    <CardTitle>ACH for large payments</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="flex items-center justify-between">
      <div>
        <Label htmlFor="ach_threshold_enabled">Require ACH at or above a threshold</Label>
        <p className="text-xs text-muted-foreground">
          Hides the card option for payments at or above this amount.
        </p>
      </div>
      <Switch
        id="ach_threshold_enabled"
        checked={connection.ach_preferred_threshold != null}
        onCheckedChange={(v) => {
          const next = v ? 5000 : null;
          setConnection({ ...connection, ach_preferred_threshold: next });
          patch("ach_preferred_threshold", next, 50);
        }}
      />
    </div>
    {connection.ach_preferred_threshold != null && (
      <div className="space-y-2">
        <Label htmlFor="ach_threshold">Amount ($)</Label>
        <Input
          id="ach_threshold"
          type="number"
          step="1"
          min="0"
          defaultValue={connection.ach_preferred_threshold}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0) patch("ach_preferred_threshold", v);
          }}
          className="w-32"
        />
      </div>
    )}
  </CardContent>
</Card>
```

Add the `Switch` import to the top of the file.

- [ ] **Step 2: Preview-verify**

- Toggle card off while ACH off → error toast, no state change.
- Toggle card off while ACH on → saves → refresh page → stays off.
- Enable surcharge, change percent to 2.5 → preview updates → save happens after debounce → refresh keeps value.
- Enable ACH threshold → input appears, defaults to 5000 → change to 10000 → saves.

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/stripe/stripe-settings-client.tsx
git commit -m "feat(17a): stripe settings — payment method, surcharge, ach threshold"
```

---

## Task 16: Shared "Request Online Payment" modal component

**Files:**
- Create: `src/components/payments/payment-request-modal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export interface PaymentRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  invoiceId?: string;
  defaultTitle?: string;
  defaultAmount?: number;
  defaultRequestType?: "invoice" | "deposit" | "retainer" | "partial";
  defaultExpiryDays?: number;
  onCreated?: (paymentRequest: { id: string; job_id: string; status: string }) => void;
}

export function PaymentRequestModal({
  open,
  onOpenChange,
  jobId,
  invoiceId,
  defaultTitle = "",
  defaultAmount,
  defaultRequestType = invoiceId ? "invoice" : "deposit",
  defaultExpiryDays = 14,
  onCreated,
}: PaymentRequestModalProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [amount, setAmount] = useState<number | "">(defaultAmount ?? "");
  const [expiryDays, setExpiryDays] = useState(defaultExpiryDays);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!title.trim() || typeof amount !== "number" || amount <= 0) {
      toast.error("Title and positive amount are required");
      return;
    }
    if (expiryDays < 1 || expiryDays > 30) {
      toast.error("Expiry must be 1–30 days");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/payment-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        invoice_id: invoiceId ?? null,
        request_type:
          invoiceId && typeof defaultAmount === "number" && amount < defaultAmount
            ? "partial"
            : defaultRequestType,
        title: title.trim(),
        amount,
        link_expiry_days: expiryDays,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const { error } = (await res.json()) as { error?: string };
      toast.error(error ?? "Failed to create payment request");
      return;
    }
    const { payment_request } = (await res.json()) as {
      payment_request: { id: string; job_id: string; status: string };
    };
    onCreated?.(payment_request);
    toast.success("Payment request created — send it from the Billing section");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{invoiceId ? "Request online payment" : "Request deposit"}</DialogTitle>
          <DialogDescription>
            Creates a secure Stripe Checkout link. You can send it from the Billing section
            after Build 17b ships.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pr_title">Title</Label>
            <Input
              id="pr_title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Deposit for July re-roof"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr_amount">Amount (USD)</Label>
            <Input
              id="pr_amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => {
                const v = e.target.value;
                setAmount(v === "" ? "" : Number(v));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr_expiry">Link expiry (days)</Label>
            <Input
              id="pr_expiry"
              type="number"
              min="1"
              max="30"
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value) || 14)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting ? "Creating…" : "Create Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/payments/payment-request-modal.tsx
git commit -m "feat(17a): shared payment request modal for invoice + deposit flows"
```

---

## Task 17: Invoice detail — "Request Online Payment" button + wiring

**Files:**
- Modify: `src/components/invoices/invoice-detail-client.tsx`

- [ ] **Step 1: Read the file**

Before editing: read the current `invoice-detail-client.tsx` and find (a) the header-action area where "Send", "Mark Sent", "Download PDF" buttons render, and (b) the existing balance calculation. Also confirm whether the component receives `stripeConnected: boolean` from the page or needs to fetch it.

- [ ] **Step 2: Add a small data hook if necessary**

If the component does not already know whether Stripe is connected, add to the parent server component (`src/app/invoices/[id]/page.tsx`):

```ts
const { data: stripeConn } = await supabase
  .from("stripe_connection")
  .select("id")
  .limit(1)
  .maybeSingle();
const stripeConnected = !!stripeConn;
```

and pass `stripeConnected` into `<InvoiceDetailClient />`.

- [ ] **Step 3: Add the button and modal**

Inside `invoice-detail-client.tsx`, import and wire:

```tsx
import { useState } from "react";
import { PaymentRequestModal } from "@/components/payments/payment-request-modal";
// ... existing imports

interface InvoiceDetailClientProps {
  // ... existing props
  stripeConnected?: boolean;
}

export default function InvoiceDetailClient(props: InvoiceDetailClientProps) {
  // ... existing state

  const [payRequestOpen, setPayRequestOpen] = useState(false);
  const balance = /* existing computation */ 0;

  return (
    <>
      {/* existing JSX */}
      {props.stripeConnected && (
        <Button
          variant="default"
          onClick={() => setPayRequestOpen(true)}
          disabled={balance <= 0}
          title={balance <= 0 ? "Invoice is paid in full" : undefined}
        >
          Request Online Payment
        </Button>
      )}

      <PaymentRequestModal
        open={payRequestOpen}
        onOpenChange={setPayRequestOpen}
        jobId={invoice.job_id}
        invoiceId={invoice.id}
        defaultTitle={`Invoice ${invoice.invoice_number ?? invoice.id.slice(0, 8)}`}
        defaultAmount={balance}
        defaultRequestType="invoice"
      />
    </>
  );
}
```

Place the button in the same cluster as "Send" / "Mark Sent" / "Download PDF", matching their styling.

- [ ] **Step 4: Preview-verify**

- With no `stripe_connection` row, the button should NOT appear.
- Insert the test row from Task 14 Step 2.
- Reload an invoice with a positive balance — button appears.
- Open modal → Create Request → success toast.
- Check Supabase: `select * from payment_requests order by created_at desc limit 1;` — row exists with status `draft`, `stripe_checkout_session_id` populated.
- Check Stripe Dashboard → Developers → Events → a `checkout.session.created` event for that session.
- Reload invoice — `invoices.has_payment_request` should be `true`; the underlying job's `has_pending_payment_request` should be `true`.

- [ ] **Step 5: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/invoices/\[id\]/page.tsx src/components/invoices/invoice-detail-client.tsx
git commit -m "feat(17a): invoice detail — request online payment button + modal"
```

---

## Task 18: Job billing — "Online Payment Requests" subsection + "+ Request Deposit"

**Files:**
- Create: `src/components/payments/online-payment-requests-subsection.tsx`
- Modify: `src/components/billing/billing-section.tsx`

- [ ] **Step 1: Write the subsection component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PaymentRequestModal } from "./payment-request-modal";

interface PaymentRequestRow {
  id: string;
  title: string;
  amount: number;
  status: string;
  request_type: string;
  created_at: string;
  link_expires_at: string | null;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-foreground" },
  sent: { label: "Sent", className: "bg-blue-500/20 text-blue-700 dark:text-blue-300" },
  viewed: { label: "Viewed", className: "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300" },
  paid: { label: "Paid", className: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" },
  failed: { label: "Failed", className: "bg-red-500/20 text-red-700 dark:text-red-300" },
  refunded: { label: "Refunded", className: "bg-slate-500/20 text-slate-700 dark:text-slate-300" },
  partially_refunded: {
    label: "Partial refund",
    className: "bg-slate-500/20 text-slate-700 dark:text-slate-300",
  },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
  voided: { label: "Voided", className: "bg-muted text-muted-foreground line-through" },
};

export function OnlinePaymentRequestsSubsection({
  jobId,
  stripeConnected,
}: {
  jobId: string;
  stripeConnected: boolean;
}) {
  const [rows, setRows] = useState<PaymentRequestRow[]>([]);
  const [depositOpen, setDepositOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const res = await fetch(`/api/payment-requests?job_id=${jobId}`);
    if (!res.ok) return;
    const { payment_requests } = (await res.json()) as { payment_requests: PaymentRequestRow[] };
    setRows(payment_requests);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, [jobId]);

  const onVoid = async (id: string) => {
    const res = await fetch(`/api/payment-requests/${id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "User voided from billing section" }),
    });
    if (!res.ok) {
      toast.error("Failed to void");
      return;
    }
    toast.success("Voided");
    await refresh();
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">Online Payment Requests</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No online payment requests yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const s = STATUS_STYLES[r.status] ?? STATUS_STYLES.draft;
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded border bg-card p-3"
              >
                <div>
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">
                    ${Number(r.amount).toFixed(2)} · {r.request_type}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={s.className}>{s.label}</Badge>
                  {r.status === "draft" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onVoid(r.id)}
                    >
                      Void
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {stripeConnected && (
        <Button variant="secondary" onClick={() => setDepositOpen(true)}>
          + Request Deposit
        </Button>
      )}

      <PaymentRequestModal
        open={depositOpen}
        onOpenChange={setDepositOpen}
        jobId={jobId}
        defaultTitle=""
        defaultRequestType="deposit"
        onCreated={() => void refresh()}
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire into `billing-section.tsx`**

Read the current `billing-section.tsx` and identify the insertion point: between the progress bar / payments list and the header "+ Record Payment" button (per the explore report, this component is ~150 lines). Also add a `stripeConnected` prop if not already passed in; fetch it in the parent server component the same way as Task 17 Step 2.

Insert:

```tsx
<OnlinePaymentRequestsSubsection jobId={jobId} stripeConnected={stripeConnected ?? false} />
```

between the payments listing and the footer action buttons area. The "+ Request Deposit" button lives inside the subsection, so do NOT add another button to the billing-section header.

- [ ] **Step 3: Preview-verify**

- Open a job detail page with the test `stripe_connection` row in place.
- Billing card shows "Online Payment Requests" subsection with the request created in Task 17.
- Click "+ Request Deposit" → modal → title "Test deposit", amount 500, create → new row appears with status Draft.
- Click "Void" on a draft row → confirmation → status changes to Voided (strikethrough badge) → the job's `has_pending_payment_request` should recompute (verify via SQL).
- Confirm the three-card layout (Job Info, Contact, Insurance) is untouched.

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/payments/online-payment-requests-subsection.tsx src/components/billing/billing-section.tsx src/components/jobs/
git commit -m "feat(17a): billing section — online payment requests subsection + request deposit"
```

---

## Task 19: Final verification against Part 8 checklist

- [ ] **Step 1: Clean build**

```bash
npx tsc --noEmit
npm run build
```
Both must succeed with no errors.

- [ ] **Step 2: Walk the 13-point checklist in the running preview**

Verify every item from the spec Part 8:

1. `npm run build` passes with no type errors. ✓ (step 1)
2. Migration runs cleanly — verify row existence of the three new tables and three new columns in Supabase SQL.
3. `/settings/stripe` shows "Connect" state when `stripe_connection` is empty. Delete any test row, reload, confirm.
4. "Connect Stripe Account" redirects to Stripe OAuth (use a Stripe test-mode platform). Browser network tab shows the 303 redirect to `connect.stripe.com/oauth/authorize`.
5. Completing OAuth redirects back to `/settings/stripe` with connected state and correct `acct_...` value. A real round-trip requires `STRIPE_CONNECT_CLIENT_ID` and `STRIPE_CONNECT_CLIENT_SECRET` from a test-mode Stripe Connect platform; if unavailable, use the manual SQL test row plus a separate callback unit check.
6. Statement descriptor edit persists across refresh (seen a "Saved" toast, reload, value is preserved).
7. Every toggle (ACH / card / surcharge / threshold) persists and the saved value is echoed back in the row.
8. Invoice detail page shows "Request Online Payment" when connected; button disabled with tooltip on zero balance.
9. Creating a request: row in `payment_requests` with status `draft`, Stripe Dashboard has `checkout.session.created` event, row appears in the job Billing section's new subsection.
10. `jobs.has_pending_payment_request` = `true` after creation (SQL verify).
11. Voiding a draft calls `sessions.expire` (check Stripe events for `checkout.session.expired`), row status = `voided`, flags recomputed on job/invoice.
12. Disconnecting clears `stripe_connection` but `payment_requests` rows persist (SQL: `select count(*) from payment_requests` before/after).
13. All new UI respects dark mode — toggle app theme and verify no hardcoded colors; every badge/card uses existing OKLCH tokens.

- [ ] **Step 3: Final commit (if any tweaks needed)**

Only commit if Step 2 surfaced small fixes. Otherwise, nothing to commit.

- [ ] **Step 4: Report completion**

Report to user in ≤100 words:
- Tasks 1–18 complete + all 13 Part 8 checklist items verified.
- Note any items that could not be end-to-end tested (e.g. OAuth round-trip if no Connect platform available) and what was substituted.
- Explicitly confirm: did NOT implement 17b (/pay/[token]) or 17c (webhook handler).

---

## Notes on scope and deviations from spec

1. **`STRIPE_CONNECT_CLIENT_SECRET` env var.** Spec says no platform secret in env, but Stripe's OAuth token exchange requires it. This is the platform's secret, not any tenant account's, and is used only during the OAuth dance. Flagged in Task 8 — if the user prefers, fail closed until someone approves.
2. **`success_url`/`cancel_url` reference `/pay/[token]` which doesn't exist yet** — per spec, that's fine; the routes land in 17b. Stripe will 404 on redirect but won't block checkout-session creation.
3. **No test framework available.** Per project memory, verification is manual preview + tsc. Each UI task includes a preview-verify step; each API task includes a post-create SQL spot-check.
4. **Single-row `stripe_connection` pattern** matches the spec's "delete existing, insert new". A `unique` constraint isn't added because the delete-then-insert flow keeps the invariant and a constraint would complicate the reset-on-disconnect path.
5. **Migration numbering.** Current high is `build38`. Plan uses `build39`. Rename if something higher has landed.
6. **Auth gate is `requirePermission(supabase, key)`.** The existing `requireAdmin` gate in `src/lib/qb/auth.ts` only checks admin. Task 6 introduces a permission-keyed variant mirroring its return shape. Admins still pass all permission checks by virtue of the role check inside `requirePermission`.

---

## Self-review summary

Spec-section → task mapping:
- Part 2 (deps/env) → Task 1 + Task 8 (client secret addendum)
- Part 3 (migration) → Task 2
- Part 4 (settings page) → Tasks 12, 13, 14, 15
- Part 5 (API routes) → Tasks 3 (client), 4 (state), 5 (token), 8 (connect), 9 (disconnect + settings), 10 (create), 11 (detail + void)
- Part 6 (UI integration) → Tasks 16 (modal), 17 (invoice), 18 (job billing)
- Part 7 (DO NOT CHANGE) → enforced via file-touch list + preview verification
- Part 8 (checklist) → Task 19

No placeholders remain in the code examples; the two called-out stubs (session-extraction in Task 6 / 8, and real permission check) are explicitly flagged as "replace before ship". All types, method names, and paths referenced in later tasks (`StripeConnectionRow`, `PaymentRequestModal`, `OnlinePaymentRequestsSubsection`, `loadStripeConnection`, `getStripeClient`) are defined in earlier tasks and used consistently.
