-- Build 17b — Payment email settings + audit-log reuse
-- Creates a singleton payment_email_settings row (mirroring the
-- contract_email_settings pattern from build33), a default seed, and
-- relaxes contract_events.contract_id so payment-send events can log
-- into the same audit table per Build 17b spec Part 5.

-- ---------------------------------------------------------------------------
-- payment_email_settings — one row expected, seeded below.
-- ---------------------------------------------------------------------------
create table if not exists payment_email_settings (
  id uuid primary key default gen_random_uuid(),
  send_from_email text not null default '',
  send_from_name text not null default '',
  reply_to_email text,
  provider text not null default 'resend'
    check (provider in ('resend','email_account')),
  email_account_id uuid references email_accounts(id) on delete set null,
  payment_request_subject_template text not null default '',
  payment_request_body_template text not null default '',
  payment_reminder_subject_template text not null default '',
  payment_reminder_body_template text not null default '',
  reminder_day_offsets jsonb not null default '[3, 7]'::jsonb,
  default_link_expiry_days integer not null default 7
    check (default_link_expiry_days between 1 and 30),
  fee_disclosure_text text,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_payment_email_settings_updated_at on payment_email_settings;
create trigger trg_payment_email_settings_updated_at
  before update on payment_email_settings
  for each row execute function update_updated_at();

alter table payment_email_settings enable row level security;

drop policy if exists "Allow all on payment_email_settings" on payment_email_settings;
create policy "Allow all on payment_email_settings" on payment_email_settings
  for all using (true) with check (true);

grant all on payment_email_settings to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Relax contract_events.contract_id so payment send/view/reminder events
-- can be logged into the same audit table (spec Part 5). Payment rows
-- carry contract_id=NULL and store payment_request_id in metadata.
-- ---------------------------------------------------------------------------
alter table contract_events
  alter column contract_id drop not null;

-- Existing CHECK on event_type already permits: created, sent, email_delivered,
-- email_opened, link_viewed, signed, reminder_sent, voided, expired.
-- 'signed' is contract-only; payments reuse the other eight values.

-- ---------------------------------------------------------------------------
-- Seed default payment_email_settings row. Send-from fields are intentionally
-- blank — /settings/payments shows a setup banner until they're filled. Send
-- API hard-fails if either is empty, matching contract_email_settings behavior.
-- ---------------------------------------------------------------------------
insert into payment_email_settings (
  send_from_email,
  send_from_name,
  provider,
  payment_request_subject_template,
  payment_request_body_template,
  payment_reminder_subject_template,
  payment_reminder_body_template,
  reminder_day_offsets,
  default_link_expiry_days,
  fee_disclosure_text
) values (
  '',
  '',
  'resend',
  'Payment request: {{request_title}}',
  '<p>Hi {{customer_name}},</p><p>You have a payment request from <strong>{{company_name}}</strong> for <strong>{{amount_formatted}}</strong> — {{request_title}}.</p><p><a href="{{payment_link}}">Pay securely online</a></p><p>This secure link expires in {{link_expires_in_days}} days. Pay by bank transfer (ACH) to avoid card processing fees.</p><p>Questions? Reply to this email or call {{company_phone}}.</p><p>Thanks,<br>{{company_name}}</p>',
  'Reminder: {{request_title}} ({{amount_formatted}})',
  '<p>Hi {{customer_name}},</p><p>Just a reminder that your payment for <strong>{{request_title}}</strong> ({{amount_formatted}}) is still open.</p><p><a href="{{payment_link}}">Pay securely online</a></p><p>The link expires on {{link_expires_at}}. Let us know if you have any questions.</p><p>{{company_name}}<br>{{company_phone}}</p>',
  '[3, 7]'::jsonb,
  7,
  'A 3% service fee applies to card payments to cover payment processing costs. Pay by bank transfer (ACH) to avoid this fee.'
);
