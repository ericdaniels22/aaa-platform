-- Build 18a (build45) — Set NOT NULL, add FK to organizations, and index
-- organization_id on every bucket-A/B table. Bucket-D gets the FK but the
-- column stays nullable (NULL = Nookleus-provided default).
--
-- Purpose:   Lock in the column semantics now that build44 has backfilled.
--            The index is critical for RLS policy performance once
--            enforcement turns on in 18b.
-- Depends on: build44 (every bucket-A/B row populated).
-- Revert:    drop fk, drop index, drop not null. Column + data preserved.
--            See -- ROLLBACK --- block at bottom.

-- ---------------------------------------------------------------------------
-- Bucket A — SET NOT NULL + FK + index (31 tables)
-- ---------------------------------------------------------------------------
alter table public.contacts                  alter column organization_id set not null;
alter table public.contacts                  add constraint fk_contacts_organization                foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_contacts_organization_id on public.contacts(organization_id);

alter table public.jobs                      alter column organization_id set not null;
alter table public.jobs                      add constraint fk_jobs_organization                    foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_jobs_organization_id on public.jobs(organization_id);

alter table public.invoices                  alter column organization_id set not null;
alter table public.invoices                  add constraint fk_invoices_organization                foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_invoices_organization_id on public.invoices(organization_id);

alter table public.payments                  alter column organization_id set not null;
alter table public.payments                  add constraint fk_payments_organization                foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_payments_organization_id on public.payments(organization_id);

alter table public.payment_requests          alter column organization_id set not null;
alter table public.payment_requests          add constraint fk_payment_requests_organization        foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_payment_requests_organization_id on public.payment_requests(organization_id);

alter table public.refunds                   alter column organization_id set not null;
alter table public.refunds                   add constraint fk_refunds_organization                 foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_refunds_organization_id on public.refunds(organization_id);

alter table public.stripe_events             alter column organization_id set not null;
alter table public.stripe_events             add constraint fk_stripe_events_organization           foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_stripe_events_organization_id on public.stripe_events(organization_id);

alter table public.stripe_disputes           alter column organization_id set not null;
alter table public.stripe_disputes           add constraint fk_stripe_disputes_organization         foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_stripe_disputes_organization_id on public.stripe_disputes(organization_id);

alter table public.stripe_connection         alter column organization_id set not null;
alter table public.stripe_connection         add constraint fk_stripe_connection_organization       foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_stripe_connection_organization_id on public.stripe_connection(organization_id);

alter table public.qb_connection             alter column organization_id set not null;
alter table public.qb_connection             add constraint fk_qb_connection_organization           foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_qb_connection_organization_id on public.qb_connection(organization_id);

alter table public.qb_mappings               alter column organization_id set not null;
alter table public.qb_mappings               add constraint fk_qb_mappings_organization             foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_qb_mappings_organization_id on public.qb_mappings(organization_id);

alter table public.qb_sync_log               alter column organization_id set not null;
alter table public.qb_sync_log               add constraint fk_qb_sync_log_organization             foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_qb_sync_log_organization_id on public.qb_sync_log(organization_id);

alter table public.expenses                  alter column organization_id set not null;
alter table public.expenses                  add constraint fk_expenses_organization                foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_expenses_organization_id on public.expenses(organization_id);

alter table public.vendors                   alter column organization_id set not null;
alter table public.vendors                   add constraint fk_vendors_organization                 foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_vendors_organization_id on public.vendors(organization_id);

alter table public.email_accounts            alter column organization_id set not null;
alter table public.email_accounts            add constraint fk_email_accounts_organization          foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_email_accounts_organization_id on public.email_accounts(organization_id);

alter table public.contract_templates        alter column organization_id set not null;
alter table public.contract_templates        add constraint fk_contract_templates_organization      foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_contract_templates_organization_id on public.contract_templates(organization_id);

alter table public.contracts                 alter column organization_id set not null;
alter table public.contracts                 add constraint fk_contracts_organization               foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_contracts_organization_id on public.contracts(organization_id);

alter table public.contract_email_settings   alter column organization_id set not null;
alter table public.contract_email_settings   add constraint fk_contract_email_settings_organization foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_contract_email_settings_organization_id on public.contract_email_settings(organization_id);

alter table public.invoice_email_settings    alter column organization_id set not null;
alter table public.invoice_email_settings    add constraint fk_invoice_email_settings_organization  foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_invoice_email_settings_organization_id on public.invoice_email_settings(organization_id);

alter table public.payment_email_settings    alter column organization_id set not null;
alter table public.payment_email_settings    add constraint fk_payment_email_settings_organization  foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_payment_email_settings_organization_id on public.payment_email_settings(organization_id);

alter table public.company_settings          alter column organization_id set not null;
alter table public.company_settings          add constraint fk_company_settings_organization        foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_company_settings_organization_id on public.company_settings(organization_id);

alter table public.form_config               alter column organization_id set not null;
alter table public.form_config               add constraint fk_form_config_organization             foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_form_config_organization_id on public.form_config(organization_id);

alter table public.photos                    alter column organization_id set not null;
alter table public.photos                    add constraint fk_photos_organization                  foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_photos_organization_id on public.photos(organization_id);

alter table public.photo_tags                alter column organization_id set not null;
alter table public.photo_tags                add constraint fk_photo_tags_organization              foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_photo_tags_organization_id on public.photo_tags(organization_id);

alter table public.photo_reports             alter column organization_id set not null;
alter table public.photo_reports             add constraint fk_photo_reports_organization           foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_photo_reports_organization_id on public.photo_reports(organization_id);

alter table public.photo_report_templates    alter column organization_id set not null;
alter table public.photo_report_templates    add constraint fk_photo_report_templates_organization  foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_photo_report_templates_organization_id on public.photo_report_templates(organization_id);

alter table public.notifications             alter column organization_id set not null;
alter table public.notifications             add constraint fk_notifications_organization           foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_notifications_organization_id on public.notifications(organization_id);

alter table public.jarvis_conversations      alter column organization_id set not null;
alter table public.jarvis_conversations      add constraint fk_jarvis_conversations_organization    foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_jarvis_conversations_organization_id on public.jarvis_conversations(organization_id);

alter table public.jarvis_alerts             alter column organization_id set not null;
alter table public.jarvis_alerts             add constraint fk_jarvis_alerts_organization           foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_jarvis_alerts_organization_id on public.jarvis_alerts(organization_id);

alter table public.marketing_assets          alter column organization_id set not null;
alter table public.marketing_assets          add constraint fk_marketing_assets_organization        foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_marketing_assets_organization_id on public.marketing_assets(organization_id);

alter table public.marketing_drafts          alter column organization_id set not null;
alter table public.marketing_drafts          add constraint fk_marketing_drafts_organization        foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_marketing_drafts_organization_id on public.marketing_drafts(organization_id);

-- ---------------------------------------------------------------------------
-- Bucket B — SET NOT NULL + FK + index (13 tables)
-- ---------------------------------------------------------------------------
alter table public.job_activities            alter column organization_id set not null;
alter table public.job_activities            add constraint fk_job_activities_organization          foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_job_activities_organization_id on public.job_activities(organization_id);

alter table public.job_adjusters             alter column organization_id set not null;
alter table public.job_adjusters             add constraint fk_job_adjusters_organization           foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_job_adjusters_organization_id on public.job_adjusters(organization_id);

alter table public.job_custom_fields         alter column organization_id set not null;
alter table public.job_custom_fields         add constraint fk_job_custom_fields_organization       foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_job_custom_fields_organization_id on public.job_custom_fields(organization_id);

alter table public.job_files                 alter column organization_id set not null;
alter table public.job_files                 add constraint fk_job_files_organization               foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_job_files_organization_id on public.job_files(organization_id);

alter table public.invoice_line_items        alter column organization_id set not null;
alter table public.invoice_line_items        add constraint fk_invoice_line_items_organization      foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_invoice_line_items_organization_id on public.invoice_line_items(organization_id);

alter table public.line_items                alter column organization_id set not null;
alter table public.line_items                add constraint fk_line_items_organization              foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_line_items_organization_id on public.line_items(organization_id);

alter table public.emails                    alter column organization_id set not null;
alter table public.emails                    add constraint fk_emails_organization                  foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_emails_organization_id on public.emails(organization_id);

alter table public.email_attachments         alter column organization_id set not null;
alter table public.email_attachments         add constraint fk_email_attachments_organization       foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_email_attachments_organization_id on public.email_attachments(organization_id);

alter table public.email_signatures          alter column organization_id set not null;
alter table public.email_signatures          add constraint fk_email_signatures_organization        foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_email_signatures_organization_id on public.email_signatures(organization_id);

alter table public.contract_signers          alter column organization_id set not null;
alter table public.contract_signers          add constraint fk_contract_signers_organization        foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_contract_signers_organization_id on public.contract_signers(organization_id);

alter table public.contract_events           alter column organization_id set not null;
alter table public.contract_events           add constraint fk_contract_events_organization         foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_contract_events_organization_id on public.contract_events(organization_id);

alter table public.photo_tag_assignments     alter column organization_id set not null;
alter table public.photo_tag_assignments     add constraint fk_photo_tag_assignments_organization   foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_photo_tag_assignments_organization_id on public.photo_tag_assignments(organization_id);

alter table public.photo_annotations         alter column organization_id set not null;
alter table public.photo_annotations         add constraint fk_photo_annotations_organization       foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_photo_annotations_organization_id on public.photo_annotations(organization_id);

-- ---------------------------------------------------------------------------
-- Bucket D — FK + index only (column stays NULLABLE)
-- ---------------------------------------------------------------------------
alter table public.expense_categories        add constraint fk_expense_categories_organization      foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_expense_categories_organization_id on public.expense_categories(organization_id);

alter table public.damage_types              add constraint fk_damage_types_organization            foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_damage_types_organization_id on public.damage_types(organization_id);

alter table public.job_statuses              add constraint fk_job_statuses_organization            foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_job_statuses_organization_id on public.job_statuses(organization_id);

alter table public.category_rules            add constraint fk_category_rules_organization          foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_category_rules_organization_id on public.category_rules(organization_id);

alter table public.knowledge_documents       add constraint fk_knowledge_documents_organization     foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_knowledge_documents_organization_id on public.knowledge_documents(organization_id);

alter table public.knowledge_chunks          add constraint fk_knowledge_chunks_organization        foreign key (organization_id) references public.organizations(id) on delete restrict;
create index if not exists idx_knowledge_chunks_organization_id on public.knowledge_chunks(organization_id);

-- ROLLBACK ---
-- Drop FKs, drop indexes, drop NOT NULL. Column + data preserved.
-- alter table public.contacts                  drop constraint if exists fk_contacts_organization;
-- drop index if exists public.idx_contacts_organization_id;
-- alter table public.contacts                  alter column organization_id drop not null;
-- (repeat pattern for every table above)
