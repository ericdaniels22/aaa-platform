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
