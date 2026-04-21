-- Build 17c — Webhook reconciliation, receipts, refunds, QuickBooks sync.
-- Widens CHECKs, adds columns to existing tables, creates refunds +
-- stripe_disputes + notifications tables, and seeds new email templates.

-- ---------------------------------------------------------------------------
-- 1. Widen contract_events.event_type CHECK to cover payment lifecycle.
--    Original values (build33 line 81): 'created','sent','email_delivered',
--    'email_opened','link_viewed','signed','reminder_sent','voided','expired'.
--    Adding six: 'paid','payment_failed','refunded','partially_refunded',
--    'dispute_opened','dispute_closed'.
-- ---------------------------------------------------------------------------
alter table contract_events drop constraint if exists contract_events_event_type_check;
alter table contract_events add constraint contract_events_event_type_check
  check (event_type in (
    'created','sent','email_delivered','email_opened','link_viewed',
    'signed','reminder_sent','voided','expired',
    'paid','payment_failed','refunded','partially_refunded',
    'dispute_opened','dispute_closed'
  ));

-- ---------------------------------------------------------------------------
-- 2. Widen payments CHECKs.
--    Original (supabase/schema.sql:1-14):
--      source   in ('insurance','homeowner','other')
--      method   in ('check','ach','venmo_zelle','cash','credit_card')
--      status   in ('received','pending','due')
-- ---------------------------------------------------------------------------
alter table payments drop constraint if exists payments_source_check;
alter table payments add constraint payments_source_check
  check (source in ('insurance','homeowner','other','stripe'));

alter table payments drop constraint if exists payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('check','ach','venmo_zelle','cash','credit_card','stripe_card','stripe_ach'));

alter table payments drop constraint if exists payments_status_check;
alter table payments add constraint payments_status_check
  check (status in ('received','pending','due','refunded'));

-- ---------------------------------------------------------------------------
-- 3. Add Stripe + QB columns to payments.
--    qb_payment_id already exists from build38. Add companion sync
--    status + timestamps + error, and Stripe-specific identifiers.
-- ---------------------------------------------------------------------------
alter table payments add column if not exists payment_request_id uuid references payment_requests(id) on delete set null;
alter table payments add column if not exists stripe_payment_intent_id text;
alter table payments add column if not exists stripe_charge_id text;
alter table payments add column if not exists stripe_fee_amount numeric(10,2);
alter table payments add column if not exists net_amount numeric(10,2);
alter table payments add column if not exists quickbooks_sync_status text
  check (quickbooks_sync_status in ('pending','synced','failed','not_applicable'));
alter table payments add column if not exists quickbooks_sync_attempted_at timestamptz;
alter table payments add column if not exists quickbooks_sync_error text;

create index if not exists idx_payments_payment_request_id on payments(payment_request_id);
create index if not exists idx_payments_stripe_payment_intent_id on payments(stripe_payment_intent_id);
create index if not exists idx_payments_stripe_charge_id on payments(stripe_charge_id);

-- ---------------------------------------------------------------------------
-- 4. Add Stripe receipt + QB sync columns to payment_requests.
--    receipt_pdf_path already exists from build39.
-- ---------------------------------------------------------------------------
alter table payment_requests add column if not exists stripe_receipt_url text;
alter table payment_requests add column if not exists qb_payment_id text;
alter table payment_requests add column if not exists quickbooks_sync_status text
  check (quickbooks_sync_status in ('pending','synced','failed','not_applicable'));
alter table payment_requests add column if not exists quickbooks_sync_attempted_at timestamptz;
alter table payment_requests add column if not exists quickbooks_sync_error text;

-- ---------------------------------------------------------------------------
-- 5. Add receipt + refund + internal-notification template columns to
--    payment_email_settings. Three customer-facing pairs + three internal
--    pairs = six pairs = twelve columns. Seeded via UPDATE below.
-- ---------------------------------------------------------------------------
alter table payment_email_settings
  add column if not exists payment_receipt_subject_template text not null default '',
  add column if not exists payment_receipt_body_template text not null default '',
  add column if not exists refund_confirmation_subject_template text not null default '',
  add column if not exists refund_confirmation_body_template text not null default '',
  add column if not exists payment_received_internal_subject_template text not null default '',
  add column if not exists payment_received_internal_body_template text not null default '',
  add column if not exists payment_failed_internal_subject_template text not null default '',
  add column if not exists payment_failed_internal_body_template text not null default '',
  add column if not exists refund_issued_internal_subject_template text not null default '',
  add column if not exists refund_issued_internal_body_template text not null default '',
  add column if not exists internal_notification_to_email text;

-- ---------------------------------------------------------------------------
-- 6. Seed defaults into the singleton row. Only overwrite when blank so
--    re-running the migration doesn't clobber operator edits.
-- ---------------------------------------------------------------------------
update payment_email_settings set
  payment_receipt_subject_template = case when payment_receipt_subject_template = ''
    then 'Receipt: {{request_title}} ({{amount_formatted}})' else payment_receipt_subject_template end,
  payment_receipt_body_template = case when payment_receipt_body_template = ''
    then '<p>Hi {{customer_name}},</p><p>Thank you for your payment. We received <strong>{{amount_formatted}}</strong> on {{paid_at_formatted}} for <strong>{{request_title}}</strong>.</p><p>A receipt is attached to this email. You can also view the Stripe receipt at <a href="{{stripe_receipt_url}}">{{stripe_receipt_url}}</a>.</p><p>Payment method: {{payment_method_display}}<br>Transaction ID: {{transaction_id}}</p><p>Thanks,<br>{{company_name}}<br>{{company_phone}}</p>'
    else payment_receipt_body_template end,
  refund_confirmation_subject_template = case when refund_confirmation_subject_template = ''
    then 'Refund issued: {{refund_amount_formatted}} for {{request_title}}' else refund_confirmation_subject_template end,
  refund_confirmation_body_template = case when refund_confirmation_body_template = ''
    then '<p>Hi {{customer_name}},</p><p>We have issued a refund of <strong>{{refund_amount_formatted}}</strong> against your payment for <strong>{{request_title}}</strong>.</p><p>{{refund_reason}}</p><p>Refunds typically take 5–10 business days to appear on your statement, depending on your bank.</p><p>Thanks,<br>{{company_name}}<br>{{company_phone}}</p>'
    else refund_confirmation_body_template end,
  payment_received_internal_subject_template = case when payment_received_internal_subject_template = ''
    then 'Payment received: {{amount_formatted}} — job {{job_number}}' else payment_received_internal_subject_template end,
  payment_received_internal_body_template = case when payment_received_internal_body_template = ''
    then '<p><strong>{{payer_name}}</strong> just paid <strong>{{amount_formatted}}</strong> for <strong>{{request_title}}</strong> on job <strong>{{job_number}}</strong>.</p><p>Method: {{payment_method_display}}<br>Stripe fee: {{stripe_fee_formatted}}<br>Net to bank: {{net_amount_formatted}}</p><p><a href="{{job_link}}">View job</a></p>'
    else payment_received_internal_body_template end,
  payment_failed_internal_subject_template = case when payment_failed_internal_subject_template = ''
    then 'Payment failed: {{amount_formatted}} — job {{job_number}}' else payment_failed_internal_subject_template end,
  payment_failed_internal_body_template = case when payment_failed_internal_body_template = ''
    then '<p>A payment attempt failed.</p><p>Job: <strong>{{job_number}}</strong><br>Request: {{request_title}}<br>Amount: {{amount_formatted}}<br>Payer: {{payer_name}} ({{payer_email}})<br>Reason: {{failure_reason}}</p><p><a href="{{job_link}}">View job</a></p><p>Stripe has notified the customer directly. No action required unless they reach out.</p>'
    else payment_failed_internal_body_template end,
  refund_issued_internal_subject_template = case when refund_issued_internal_subject_template = ''
    then 'Refund confirmed: {{refund_amount_formatted}} — job {{job_number}}' else refund_issued_internal_subject_template end,
  refund_issued_internal_body_template = case when refund_issued_internal_body_template = ''
    then '<p>A refund of <strong>{{refund_amount_formatted}}</strong> has been confirmed by Stripe on job <strong>{{job_number}}</strong> ({{request_title}}).</p><p>Reason (internal): {{refund_reason}}<br>Refunded by: {{refunded_by_name}}</p><p><a href="{{job_link}}">View job</a></p>'
    else refund_issued_internal_body_template end
  where id is not null;

-- ---------------------------------------------------------------------------
-- 7. refunds table — one row per refund request, pending → succeeded|failed.
-- ---------------------------------------------------------------------------
create table if not exists refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  payment_request_id uuid references payment_requests(id) on delete set null,
  amount numeric(10,2) not null check (amount > 0),
  reason text,
  include_reason_in_customer_email boolean not null default false,
  notify_customer boolean not null default true,
  stripe_refund_id text unique,
  status text not null default 'pending'
    check (status in ('pending','succeeded','failed','canceled')),
  failure_reason text,
  refunded_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  refunded_at timestamptz
);

create index if not exists idx_refunds_payment_id on refunds(payment_id);
create index if not exists idx_refunds_payment_request_id on refunds(payment_request_id);
create index if not exists idx_refunds_stripe_refund_id on refunds(stripe_refund_id);

alter table refunds enable row level security;
drop policy if exists "Allow all on refunds" on refunds;
create policy "Allow all on refunds" on refunds for all using (true) with check (true);
grant all on refunds to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. stripe_disputes table — minimal tracking; no evidence flow in 17c.
-- ---------------------------------------------------------------------------
create table if not exists stripe_disputes (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references payments(id) on delete set null,
  payment_request_id uuid references payment_requests(id) on delete set null,
  stripe_dispute_id text unique not null,
  amount numeric(10,2),
  reason text,
  -- nullable: if Stripe introduces a new dispute status we haven't coded for,
  -- the handler's normalizeStatus() returns null rather than throwing. The
  -- row is still inserted so nothing is lost; status gets updated on the
  -- next charge.dispute.* event.
  status text check (status in (
    'warning_needs_response','warning_under_review','warning_closed',
    'needs_response','under_review','won','lost'
  )),
  evidence_due_by timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stripe_disputes_stripe_dispute_id on stripe_disputes(stripe_dispute_id);
create index if not exists idx_stripe_disputes_payment_id on stripe_disputes(payment_id);

drop trigger if exists trg_stripe_disputes_updated_at on stripe_disputes;
create trigger trg_stripe_disputes_updated_at
  before update on stripe_disputes
  for each row execute function update_updated_at();

alter table stripe_disputes enable row level security;
drop policy if exists "Allow all on stripe_disputes" on stripe_disputes;
create policy "Allow all on stripe_disputes" on stripe_disputes for all using (true) with check (true);
grant all on stripe_disputes to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Extend the existing Build 14g notifications table with 17c payment-event
--    columns + widened type CHECK. The 14g table is the source of truth —
--    do not recreate it. These ALTERs are idempotent via "if not exists" /
--    "drop constraint if exists".
-- ---------------------------------------------------------------------------
alter table notifications add column if not exists href text;
alter table notifications add column if not exists priority text not null default 'normal';
alter table notifications add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table notifications drop constraint if exists notifications_priority_check;
alter table notifications add constraint notifications_priority_check
  check (priority in ('normal','high'));

-- Widen the type CHECK to include the 5 new 17c event types while keeping
-- all 8 existing 14g values.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'new_job','status_change','payment','activity','photo','email','overdue','reminder',
    'payment_received','payment_failed','refund_issued','dispute_opened','qb_sync_failed'
  ));

-- Also widen the notification_preferences allowed types so admins can
-- toggle the new payment-event notifications in the settings UI. The
-- existing column is just `text` without a CHECK, so this is a no-op at
-- the DB level — but documenting here as a contract.
--   Allowed notification_type values (14g + 17c):
--     new_job, status_change, payment, activity, photo, email, overdue,
--     reminder, payment_received, payment_failed, refund_issued,
--     dispute_opened, qb_sync_failed
