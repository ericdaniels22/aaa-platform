-- Build 18a (build49) — Add tenant-isolation PERMISSIVE policies to every
-- bucket-A/B/D table. Existing "Allow all" permissive policies are NOT
-- dropped in 18a, so these new policies have no restrictive effect yet.
-- 18b drops the allow-alls and enforcement turns on.
--
-- Purpose:   Stage RLS without flipping enforcement. Allows Eric to smoke
--            test the multi-tenant schema with real data under the current
--            permissive regime, then flip to enforcing mode in 18b by
--            dropping allow-alls — a predictable, pure-SQL change.
-- Depends on: build42 (nookleus.active_organization_id + aaa_organization_id),
--             build45 (organization_id NOT NULL + indexed on tenant tables).
-- Revert:    DROP POLICY tenant_isolation_* per table; DISABLE ROW LEVEL
--            SECURITY on job_files + invoice_line_items. See -- ROLLBACK ---.
--
-- Policy naming: tenant_isolation_{table}. Distinct from any existing
-- allow-all policy name on the same table to avoid CREATE POLICY conflicts.

-- ---------------------------------------------------------------------------
-- 1. Turn ON RLS for the two tables that had it off. Existing allow-all
--    policies don't exist on these — they were relying on relrowsecurity=false.
--    Add a tenant-isolation policy alongside a new allow-all so behavior
--    matches the other tables during the non-enforcing 18a window.
-- ---------------------------------------------------------------------------
alter table public.job_files           enable row level security;
alter table public.invoice_line_items  enable row level security;

create policy "Allow all on job_files"
  on public.job_files
  for all
  using (true)
  with check (true);

create policy "Allow all on invoice_line_items"
  on public.invoice_line_items
  for all
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 2. Bucket A — tenant isolation (31 tables).
--    Pattern: strict active-org match + membership check. Authenticated only.
-- ---------------------------------------------------------------------------

create policy tenant_isolation_contacts on public.contacts for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contacts.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contacts.organization_id)
  );

create policy tenant_isolation_jobs on public.jobs for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = jobs.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = jobs.organization_id)
  );

create policy tenant_isolation_invoices on public.invoices for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = invoices.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = invoices.organization_id)
  );

create policy tenant_isolation_payments on public.payments for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = payments.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = payments.organization_id)
  );

create policy tenant_isolation_payment_requests on public.payment_requests for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = payment_requests.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = payment_requests.organization_id)
  );

create policy tenant_isolation_refunds on public.refunds for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = refunds.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = refunds.organization_id)
  );

create policy tenant_isolation_stripe_events on public.stripe_events for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = stripe_events.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = stripe_events.organization_id)
  );

create policy tenant_isolation_stripe_disputes on public.stripe_disputes for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = stripe_disputes.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = stripe_disputes.organization_id)
  );

create policy tenant_isolation_stripe_connection on public.stripe_connection for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = stripe_connection.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = stripe_connection.organization_id)
  );

create policy tenant_isolation_qb_connection on public.qb_connection for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = qb_connection.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = qb_connection.organization_id)
  );

create policy tenant_isolation_qb_mappings on public.qb_mappings for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = qb_mappings.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = qb_mappings.organization_id)
  );

create policy tenant_isolation_qb_sync_log on public.qb_sync_log for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = qb_sync_log.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = qb_sync_log.organization_id)
  );

create policy tenant_isolation_expenses on public.expenses for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = expenses.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = expenses.organization_id)
  );

create policy tenant_isolation_vendors on public.vendors for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = vendors.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = vendors.organization_id)
  );

create policy tenant_isolation_email_accounts on public.email_accounts for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = email_accounts.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = email_accounts.organization_id)
  );

create policy tenant_isolation_contract_templates on public.contract_templates for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contract_templates.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contract_templates.organization_id)
  );

create policy tenant_isolation_contracts on public.contracts for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contracts.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contracts.organization_id)
  );

create policy tenant_isolation_contract_email_settings on public.contract_email_settings for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contract_email_settings.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contract_email_settings.organization_id)
  );

create policy tenant_isolation_invoice_email_settings on public.invoice_email_settings for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = invoice_email_settings.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = invoice_email_settings.organization_id)
  );

create policy tenant_isolation_payment_email_settings on public.payment_email_settings for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = payment_email_settings.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = payment_email_settings.organization_id)
  );

create policy tenant_isolation_company_settings on public.company_settings for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = company_settings.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = company_settings.organization_id)
  );

create policy tenant_isolation_form_config on public.form_config for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = form_config.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = form_config.organization_id)
  );

create policy tenant_isolation_photos on public.photos for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photos.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photos.organization_id)
  );

create policy tenant_isolation_photo_tags on public.photo_tags for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photo_tags.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photo_tags.organization_id)
  );

create policy tenant_isolation_photo_reports on public.photo_reports for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photo_reports.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photo_reports.organization_id)
  );

create policy tenant_isolation_photo_report_templates on public.photo_report_templates for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photo_report_templates.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photo_report_templates.organization_id)
  );

create policy tenant_isolation_notifications on public.notifications for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = notifications.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = notifications.organization_id)
  );

create policy tenant_isolation_jarvis_conversations on public.jarvis_conversations for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = jarvis_conversations.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = jarvis_conversations.organization_id)
  );

create policy tenant_isolation_jarvis_alerts on public.jarvis_alerts for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = jarvis_alerts.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = jarvis_alerts.organization_id)
  );

create policy tenant_isolation_marketing_assets on public.marketing_assets for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = marketing_assets.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = marketing_assets.organization_id)
  );

create policy tenant_isolation_marketing_drafts on public.marketing_drafts for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = marketing_drafts.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = marketing_drafts.organization_id)
  );

-- ---------------------------------------------------------------------------
-- 3. Bucket B — same tenant-isolation pattern (13 tables).
-- ---------------------------------------------------------------------------

create policy tenant_isolation_job_activities on public.job_activities for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = job_activities.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = job_activities.organization_id)
  );

create policy tenant_isolation_job_adjusters on public.job_adjusters for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = job_adjusters.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = job_adjusters.organization_id)
  );

create policy tenant_isolation_job_custom_fields on public.job_custom_fields for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = job_custom_fields.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = job_custom_fields.organization_id)
  );

create policy tenant_isolation_job_files on public.job_files for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = job_files.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = job_files.organization_id)
  );

create policy tenant_isolation_invoice_line_items on public.invoice_line_items for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = invoice_line_items.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = invoice_line_items.organization_id)
  );

create policy tenant_isolation_line_items on public.line_items for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = line_items.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = line_items.organization_id)
  );

create policy tenant_isolation_emails on public.emails for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = emails.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = emails.organization_id)
  );

create policy tenant_isolation_email_attachments on public.email_attachments for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = email_attachments.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = email_attachments.organization_id)
  );

create policy tenant_isolation_email_signatures on public.email_signatures for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = email_signatures.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = email_signatures.organization_id)
  );

create policy tenant_isolation_contract_signers on public.contract_signers for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contract_signers.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contract_signers.organization_id)
  );

create policy tenant_isolation_contract_events on public.contract_events for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contract_events.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = contract_events.organization_id)
  );

create policy tenant_isolation_photo_tag_assignments on public.photo_tag_assignments for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photo_tag_assignments.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photo_tag_assignments.organization_id)
  );

create policy tenant_isolation_photo_annotations on public.photo_annotations for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photo_annotations.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = photo_annotations.organization_id)
  );

-- ---------------------------------------------------------------------------
-- 4. Bucket D — SELECT policy allows NULL defaults + scoped rows.
--    Mutations require a non-NULL, active-org match.
--    6 tables × 2 policies = 12 policies.
-- ---------------------------------------------------------------------------

-- expense_categories
create policy tenant_isolation_select_expense_categories on public.expense_categories for select to authenticated
  using (
    organization_id is null
    or (
      organization_id = nookleus.active_organization_id()
      and exists (select 1 from public.user_organizations uo
                   where uo.user_id = auth.uid() and uo.organization_id = expense_categories.organization_id)
    )
  );
create policy tenant_isolation_mod_expense_categories on public.expense_categories for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = expense_categories.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = expense_categories.organization_id)
  );

-- damage_types
create policy tenant_isolation_select_damage_types on public.damage_types for select to authenticated
  using (
    organization_id is null
    or (
      organization_id = nookleus.active_organization_id()
      and exists (select 1 from public.user_organizations uo
                   where uo.user_id = auth.uid() and uo.organization_id = damage_types.organization_id)
    )
  );
create policy tenant_isolation_mod_damage_types on public.damage_types for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = damage_types.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = damage_types.organization_id)
  );

-- job_statuses
create policy tenant_isolation_select_job_statuses on public.job_statuses for select to authenticated
  using (
    organization_id is null
    or (
      organization_id = nookleus.active_organization_id()
      and exists (select 1 from public.user_organizations uo
                   where uo.user_id = auth.uid() and uo.organization_id = job_statuses.organization_id)
    )
  );
create policy tenant_isolation_mod_job_statuses on public.job_statuses for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = job_statuses.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = job_statuses.organization_id)
  );

-- category_rules
create policy tenant_isolation_select_category_rules on public.category_rules for select to authenticated
  using (
    organization_id is null
    or (
      organization_id = nookleus.active_organization_id()
      and exists (select 1 from public.user_organizations uo
                   where uo.user_id = auth.uid() and uo.organization_id = category_rules.organization_id)
    )
  );
create policy tenant_isolation_mod_category_rules on public.category_rules for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = category_rules.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = category_rules.organization_id)
  );

-- knowledge_documents
create policy tenant_isolation_select_knowledge_documents on public.knowledge_documents for select to authenticated
  using (
    organization_id is null
    or (
      organization_id = nookleus.active_organization_id()
      and exists (select 1 from public.user_organizations uo
                   where uo.user_id = auth.uid() and uo.organization_id = knowledge_documents.organization_id)
    )
  );
create policy tenant_isolation_mod_knowledge_documents on public.knowledge_documents for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = knowledge_documents.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = knowledge_documents.organization_id)
  );

-- knowledge_chunks
create policy tenant_isolation_select_knowledge_chunks on public.knowledge_chunks for select to authenticated
  using (
    organization_id is null
    or (
      organization_id = nookleus.active_organization_id()
      and exists (select 1 from public.user_organizations uo
                   where uo.user_id = auth.uid() and uo.organization_id = knowledge_chunks.organization_id)
    )
  );
create policy tenant_isolation_mod_knowledge_chunks on public.knowledge_chunks for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = knowledge_chunks.organization_id)
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (select 1 from public.user_organizations uo
                 where uo.user_id = auth.uid() and uo.organization_id = knowledge_chunks.organization_id)
  );

-- ---------------------------------------------------------------------------
-- 5. organizations — members read; service role writes.
-- ---------------------------------------------------------------------------
create policy orgs_member_read on public.organizations for select to authenticated
  using (id in (select organization_id from public.user_organizations where user_id = auth.uid()));

create policy orgs_service_write on public.organizations for all to service_role
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 6. user_organizations — users read their own memberships; service role writes.
-- ---------------------------------------------------------------------------
create policy user_orgs_self_read on public.user_organizations for select to authenticated
  using (user_id = auth.uid());

create policy user_orgs_service_write on public.user_organizations for all to service_role
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 7. user_organization_permissions — self-read; admin within the same org
--    manages permissions for that org's members.
-- ---------------------------------------------------------------------------
create policy user_org_perms_self_read on public.user_organization_permissions for select to authenticated
  using (
    user_organization_id in (
      select id from public.user_organizations where user_id = auth.uid()
    )
  );

create policy user_org_perms_admin_manage on public.user_organization_permissions for all to authenticated
  using (
    exists (
      select 1
        from public.user_organizations uo_target
        join public.user_organizations uo_me on uo_me.organization_id = uo_target.organization_id
       where uo_target.id = user_organization_permissions.user_organization_id
         and uo_me.user_id = auth.uid()
         and uo_me.role = 'admin'
         and uo_target.organization_id = nookleus.active_organization_id()
    )
  )
  with check (
    exists (
      select 1
        from public.user_organizations uo_target
        join public.user_organizations uo_me on uo_me.organization_id = uo_target.organization_id
       where uo_target.id = user_organization_permissions.user_organization_id
         and uo_me.user_id = auth.uid()
         and uo_me.role = 'admin'
         and uo_target.organization_id = nookleus.active_organization_id()
    )
  );

-- ROLLBACK ---
-- Drop every tenant_isolation_* policy, plus the new policies on
-- organizations / user_organizations / user_organization_permissions, plus
-- the Allow-all + RLS toggle on job_files / invoice_line_items.
-- drop policy if exists tenant_isolation_contacts                on public.contacts;
-- drop policy if exists tenant_isolation_jobs                    on public.jobs;
-- drop policy if exists tenant_isolation_invoices                on public.invoices;
-- drop policy if exists tenant_isolation_payments                on public.payments;
-- drop policy if exists tenant_isolation_payment_requests        on public.payment_requests;
-- drop policy if exists tenant_isolation_refunds                 on public.refunds;
-- drop policy if exists tenant_isolation_stripe_events           on public.stripe_events;
-- drop policy if exists tenant_isolation_stripe_disputes         on public.stripe_disputes;
-- drop policy if exists tenant_isolation_stripe_connection       on public.stripe_connection;
-- drop policy if exists tenant_isolation_qb_connection           on public.qb_connection;
-- drop policy if exists tenant_isolation_qb_mappings             on public.qb_mappings;
-- drop policy if exists tenant_isolation_qb_sync_log             on public.qb_sync_log;
-- drop policy if exists tenant_isolation_expenses                on public.expenses;
-- drop policy if exists tenant_isolation_vendors                 on public.vendors;
-- drop policy if exists tenant_isolation_email_accounts          on public.email_accounts;
-- drop policy if exists tenant_isolation_contract_templates      on public.contract_templates;
-- drop policy if exists tenant_isolation_contracts               on public.contracts;
-- drop policy if exists tenant_isolation_contract_email_settings on public.contract_email_settings;
-- drop policy if exists tenant_isolation_invoice_email_settings  on public.invoice_email_settings;
-- drop policy if exists tenant_isolation_payment_email_settings  on public.payment_email_settings;
-- drop policy if exists tenant_isolation_company_settings        on public.company_settings;
-- drop policy if exists tenant_isolation_form_config             on public.form_config;
-- drop policy if exists tenant_isolation_photos                  on public.photos;
-- drop policy if exists tenant_isolation_photo_tags              on public.photo_tags;
-- drop policy if exists tenant_isolation_photo_reports           on public.photo_reports;
-- drop policy if exists tenant_isolation_photo_report_templates  on public.photo_report_templates;
-- drop policy if exists tenant_isolation_notifications           on public.notifications;
-- drop policy if exists tenant_isolation_jarvis_conversations    on public.jarvis_conversations;
-- drop policy if exists tenant_isolation_jarvis_alerts           on public.jarvis_alerts;
-- drop policy if exists tenant_isolation_marketing_assets        on public.marketing_assets;
-- drop policy if exists tenant_isolation_marketing_drafts        on public.marketing_drafts;
-- drop policy if exists tenant_isolation_job_activities          on public.job_activities;
-- drop policy if exists tenant_isolation_job_adjusters           on public.job_adjusters;
-- drop policy if exists tenant_isolation_job_custom_fields       on public.job_custom_fields;
-- drop policy if exists tenant_isolation_job_files               on public.job_files;
-- drop policy if exists tenant_isolation_invoice_line_items      on public.invoice_line_items;
-- drop policy if exists tenant_isolation_line_items              on public.line_items;
-- drop policy if exists tenant_isolation_emails                  on public.emails;
-- drop policy if exists tenant_isolation_email_attachments       on public.email_attachments;
-- drop policy if exists tenant_isolation_email_signatures        on public.email_signatures;
-- drop policy if exists tenant_isolation_contract_signers        on public.contract_signers;
-- drop policy if exists tenant_isolation_contract_events         on public.contract_events;
-- drop policy if exists tenant_isolation_photo_tag_assignments   on public.photo_tag_assignments;
-- drop policy if exists tenant_isolation_photo_annotations       on public.photo_annotations;
-- drop policy if exists tenant_isolation_select_expense_categories on public.expense_categories;
-- drop policy if exists tenant_isolation_mod_expense_categories    on public.expense_categories;
-- drop policy if exists tenant_isolation_select_damage_types       on public.damage_types;
-- drop policy if exists tenant_isolation_mod_damage_types          on public.damage_types;
-- drop policy if exists tenant_isolation_select_job_statuses       on public.job_statuses;
-- drop policy if exists tenant_isolation_mod_job_statuses          on public.job_statuses;
-- drop policy if exists tenant_isolation_select_category_rules    on public.category_rules;
-- drop policy if exists tenant_isolation_mod_category_rules       on public.category_rules;
-- drop policy if exists tenant_isolation_select_knowledge_documents on public.knowledge_documents;
-- drop policy if exists tenant_isolation_mod_knowledge_documents    on public.knowledge_documents;
-- drop policy if exists tenant_isolation_select_knowledge_chunks    on public.knowledge_chunks;
-- drop policy if exists tenant_isolation_mod_knowledge_chunks       on public.knowledge_chunks;
-- drop policy if exists orgs_member_read                            on public.organizations;
-- drop policy if exists orgs_service_write                          on public.organizations;
-- drop policy if exists user_orgs_self_read                         on public.user_organizations;
-- drop policy if exists user_orgs_service_write                     on public.user_organizations;
-- drop policy if exists user_org_perms_self_read                    on public.user_organization_permissions;
-- drop policy if exists user_org_perms_admin_manage                 on public.user_organization_permissions;
-- drop policy if exists "Allow all on job_files"          on public.job_files;
-- drop policy if exists "Allow all on invoice_line_items" on public.invoice_line_items;
-- alter table public.job_files          disable row level security;
-- alter table public.invoice_line_items disable row level security;
