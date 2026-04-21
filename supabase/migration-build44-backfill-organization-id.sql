-- Build 18a (build44) — Backfill organization_id on every bucket-A and
-- bucket-B table. Bucket-D rows stay NULL (Nookleus-provided defaults).
--
-- Purpose:   Populate the nullable column added in build43. Bucket-A is a
--            trivial UPDATE to the AAA UUID. Bucket-B denormalizes from
--            the parent row — dependency order matters so parents are
--            populated before children.
-- Depends on: build43 (columns exist).
-- Revert:    UPDATE public.{table} SET organization_id = NULL per bucket
--            A/B table. See -- ROLLBACK --- block at bottom.

do $$
declare
  aaa_id uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  -- -------------------------------------------------------------------------
  -- Bucket A — trivial: all existing rows belong to AAA.
  -- -------------------------------------------------------------------------
  update public.contacts                 set organization_id = aaa_id where organization_id is null;
  update public.jobs                     set organization_id = aaa_id where organization_id is null;
  update public.invoices                 set organization_id = aaa_id where organization_id is null;
  update public.payments                 set organization_id = aaa_id where organization_id is null;
  update public.payment_requests         set organization_id = aaa_id where organization_id is null;
  update public.refunds                  set organization_id = aaa_id where organization_id is null;
  update public.stripe_events            set organization_id = aaa_id where organization_id is null;
  update public.stripe_disputes          set organization_id = aaa_id where organization_id is null;
  update public.stripe_connection        set organization_id = aaa_id where organization_id is null;
  update public.qb_connection            set organization_id = aaa_id where organization_id is null;
  update public.qb_mappings              set organization_id = aaa_id where organization_id is null;
  update public.qb_sync_log              set organization_id = aaa_id where organization_id is null;
  update public.expenses                 set organization_id = aaa_id where organization_id is null;
  update public.vendors                  set organization_id = aaa_id where organization_id is null;
  update public.email_accounts           set organization_id = aaa_id where organization_id is null;
  update public.contract_templates       set organization_id = aaa_id where organization_id is null;
  update public.contracts                set organization_id = aaa_id where organization_id is null;
  update public.contract_email_settings  set organization_id = aaa_id where organization_id is null;
  update public.invoice_email_settings   set organization_id = aaa_id where organization_id is null;
  update public.payment_email_settings   set organization_id = aaa_id where organization_id is null;
  update public.company_settings         set organization_id = aaa_id where organization_id is null;
  update public.form_config              set organization_id = aaa_id where organization_id is null;
  update public.photos                   set organization_id = aaa_id where organization_id is null;
  update public.photo_tags               set organization_id = aaa_id where organization_id is null;
  update public.photo_reports            set organization_id = aaa_id where organization_id is null;
  update public.photo_report_templates   set organization_id = aaa_id where organization_id is null;
  update public.notifications            set organization_id = aaa_id where organization_id is null;
  update public.jarvis_conversations     set organization_id = aaa_id where organization_id is null;
  update public.jarvis_alerts            set organization_id = aaa_id where organization_id is null;
  update public.marketing_assets         set organization_id = aaa_id where organization_id is null;
  update public.marketing_drafts         set organization_id = aaa_id where organization_id is null;

  -- -------------------------------------------------------------------------
  -- Bucket B — denormalize from parent. ORDER MATTERS: parents first, then
  -- children of those newly-populated parents, then grandchildren.
  -- -------------------------------------------------------------------------

  -- Children of jobs (jobs already populated above)
  update public.job_activities ja
     set organization_id = j.organization_id
    from public.jobs j
   where ja.job_id = j.id and ja.organization_id is null;

  update public.job_adjusters ja
     set organization_id = j.organization_id
    from public.jobs j
   where ja.job_id = j.id and ja.organization_id is null;

  update public.job_custom_fields jcf
     set organization_id = j.organization_id
    from public.jobs j
   where jcf.job_id = j.id and jcf.organization_id is null;

  update public.job_files jf
     set organization_id = j.organization_id
    from public.jobs j
   where jf.job_id = j.id and jf.organization_id is null;

  -- Children of invoices (invoices already populated above)
  update public.invoice_line_items ili
     set organization_id = i.organization_id
    from public.invoices i
   where ili.invoice_id = i.id and ili.organization_id is null;

  update public.line_items li
     set organization_id = i.organization_id
    from public.invoices i
   where li.invoice_id = i.id and li.organization_id is null;

  -- Children of email_accounts (email_accounts populated above) — then
  -- grandchildren of emails.
  update public.emails e
     set organization_id = ea.organization_id
    from public.email_accounts ea
   where e.account_id = ea.id and e.organization_id is null;

  update public.email_attachments eat
     set organization_id = e.organization_id
    from public.emails e
   where eat.email_id = e.id and eat.organization_id is null;

  update public.email_signatures es
     set organization_id = ea.organization_id
    from public.email_accounts ea
   where es.account_id = ea.id and es.organization_id is null;

  -- Children of contracts (contracts already populated above)
  update public.contract_signers cs
     set organization_id = c.organization_id
    from public.contracts c
   where cs.contract_id = c.id and cs.organization_id is null;

  update public.contract_events ce
     set organization_id = c.organization_id
    from public.contracts c
   where ce.contract_id = c.id and ce.organization_id is null;

  -- Children of photos (photos already populated above)
  update public.photo_tag_assignments pta
     set organization_id = p.organization_id
    from public.photos p
   where pta.photo_id = p.id and pta.organization_id is null;

  update public.photo_annotations pa
     set organization_id = p.organization_id
    from public.photos p
   where pa.photo_id = p.id and pa.organization_id is null;

  -- -------------------------------------------------------------------------
  -- Bucket D — intentionally LEFT NULL (Nookleus-provided defaults):
  --   expense_categories, damage_types, job_statuses, category_rules,
  --   knowledge_documents, knowledge_chunks.
  -- No UPDATE needed.
  -- -------------------------------------------------------------------------

  -- -------------------------------------------------------------------------
  -- Safety assertions — every bucket-A/B row must now be populated.
  -- -------------------------------------------------------------------------
  if exists (select 1 from public.contacts                 where organization_id is null) then raise exception 'backfill: contacts has unbackfilled rows';                 end if;
  if exists (select 1 from public.jobs                     where organization_id is null) then raise exception 'backfill: jobs has unbackfilled rows';                     end if;
  if exists (select 1 from public.invoices                 where organization_id is null) then raise exception 'backfill: invoices has unbackfilled rows';                 end if;
  if exists (select 1 from public.payments                 where organization_id is null) then raise exception 'backfill: payments has unbackfilled rows';                 end if;
  if exists (select 1 from public.payment_requests         where organization_id is null) then raise exception 'backfill: payment_requests has unbackfilled rows';         end if;
  if exists (select 1 from public.refunds                  where organization_id is null) then raise exception 'backfill: refunds has unbackfilled rows';                  end if;
  if exists (select 1 from public.stripe_events            where organization_id is null) then raise exception 'backfill: stripe_events has unbackfilled rows';            end if;
  if exists (select 1 from public.stripe_disputes          where organization_id is null) then raise exception 'backfill: stripe_disputes has unbackfilled rows';          end if;
  if exists (select 1 from public.stripe_connection        where organization_id is null) then raise exception 'backfill: stripe_connection has unbackfilled rows';        end if;
  if exists (select 1 from public.qb_connection            where organization_id is null) then raise exception 'backfill: qb_connection has unbackfilled rows';            end if;
  if exists (select 1 from public.qb_mappings              where organization_id is null) then raise exception 'backfill: qb_mappings has unbackfilled rows';              end if;
  if exists (select 1 from public.qb_sync_log              where organization_id is null) then raise exception 'backfill: qb_sync_log has unbackfilled rows';              end if;
  if exists (select 1 from public.expenses                 where organization_id is null) then raise exception 'backfill: expenses has unbackfilled rows';                 end if;
  if exists (select 1 from public.vendors                  where organization_id is null) then raise exception 'backfill: vendors has unbackfilled rows';                  end if;
  if exists (select 1 from public.email_accounts           where organization_id is null) then raise exception 'backfill: email_accounts has unbackfilled rows';           end if;
  if exists (select 1 from public.contract_templates       where organization_id is null) then raise exception 'backfill: contract_templates has unbackfilled rows';       end if;
  if exists (select 1 from public.contracts                where organization_id is null) then raise exception 'backfill: contracts has unbackfilled rows';                end if;
  if exists (select 1 from public.contract_email_settings  where organization_id is null) then raise exception 'backfill: contract_email_settings has unbackfilled rows';  end if;
  if exists (select 1 from public.invoice_email_settings   where organization_id is null) then raise exception 'backfill: invoice_email_settings has unbackfilled rows';   end if;
  if exists (select 1 from public.payment_email_settings   where organization_id is null) then raise exception 'backfill: payment_email_settings has unbackfilled rows';   end if;
  if exists (select 1 from public.company_settings         where organization_id is null) then raise exception 'backfill: company_settings has unbackfilled rows';         end if;
  if exists (select 1 from public.form_config              where organization_id is null) then raise exception 'backfill: form_config has unbackfilled rows';              end if;
  if exists (select 1 from public.photos                   where organization_id is null) then raise exception 'backfill: photos has unbackfilled rows';                   end if;
  if exists (select 1 from public.photo_tags               where organization_id is null) then raise exception 'backfill: photo_tags has unbackfilled rows';               end if;
  if exists (select 1 from public.photo_reports            where organization_id is null) then raise exception 'backfill: photo_reports has unbackfilled rows';            end if;
  if exists (select 1 from public.photo_report_templates   where organization_id is null) then raise exception 'backfill: photo_report_templates has unbackfilled rows';   end if;
  if exists (select 1 from public.notifications            where organization_id is null) then raise exception 'backfill: notifications has unbackfilled rows';            end if;
  if exists (select 1 from public.jarvis_conversations     where organization_id is null) then raise exception 'backfill: jarvis_conversations has unbackfilled rows';     end if;
  if exists (select 1 from public.jarvis_alerts            where organization_id is null) then raise exception 'backfill: jarvis_alerts has unbackfilled rows';            end if;
  if exists (select 1 from public.marketing_assets         where organization_id is null) then raise exception 'backfill: marketing_assets has unbackfilled rows';         end if;
  if exists (select 1 from public.marketing_drafts         where organization_id is null) then raise exception 'backfill: marketing_drafts has unbackfilled rows';         end if;

  if exists (select 1 from public.job_activities           where organization_id is null) then raise exception 'backfill: job_activities has unbackfilled rows';           end if;
  if exists (select 1 from public.job_adjusters            where organization_id is null) then raise exception 'backfill: job_adjusters has unbackfilled rows';            end if;
  if exists (select 1 from public.job_custom_fields        where organization_id is null) then raise exception 'backfill: job_custom_fields has unbackfilled rows';        end if;
  if exists (select 1 from public.job_files                where organization_id is null) then raise exception 'backfill: job_files has unbackfilled rows';                end if;
  if exists (select 1 from public.invoice_line_items       where organization_id is null) then raise exception 'backfill: invoice_line_items has unbackfilled rows';       end if;
  if exists (select 1 from public.line_items               where organization_id is null) then raise exception 'backfill: line_items has unbackfilled rows';               end if;
  if exists (select 1 from public.emails                   where organization_id is null) then raise exception 'backfill: emails has unbackfilled rows';                   end if;
  if exists (select 1 from public.email_attachments        where organization_id is null) then raise exception 'backfill: email_attachments has unbackfilled rows';        end if;
  if exists (select 1 from public.email_signatures         where organization_id is null) then raise exception 'backfill: email_signatures has unbackfilled rows';         end if;
  if exists (select 1 from public.contract_signers         where organization_id is null) then raise exception 'backfill: contract_signers has unbackfilled rows';         end if;
  if exists (select 1 from public.contract_events          where organization_id is null) then raise exception 'backfill: contract_events has unbackfilled rows';          end if;
  if exists (select 1 from public.photo_tag_assignments    where organization_id is null) then raise exception 'backfill: photo_tag_assignments has unbackfilled rows';    end if;
  if exists (select 1 from public.photo_annotations        where organization_id is null) then raise exception 'backfill: photo_annotations has unbackfilled rows';        end if;
end $$;

-- ROLLBACK ---
-- Reverts backfill on bucket-A and bucket-B. Bucket-D was never touched.
-- update public.contacts                 set organization_id = null;
-- update public.jobs                     set organization_id = null;
-- update public.invoices                 set organization_id = null;
-- update public.payments                 set organization_id = null;
-- update public.payment_requests         set organization_id = null;
-- update public.refunds                  set organization_id = null;
-- update public.stripe_events            set organization_id = null;
-- update public.stripe_disputes          set organization_id = null;
-- update public.stripe_connection        set organization_id = null;
-- update public.qb_connection            set organization_id = null;
-- update public.qb_mappings              set organization_id = null;
-- update public.qb_sync_log              set organization_id = null;
-- update public.expenses                 set organization_id = null;
-- update public.vendors                  set organization_id = null;
-- update public.email_accounts           set organization_id = null;
-- update public.contract_templates       set organization_id = null;
-- update public.contracts                set organization_id = null;
-- update public.contract_email_settings  set organization_id = null;
-- update public.invoice_email_settings   set organization_id = null;
-- update public.payment_email_settings   set organization_id = null;
-- update public.company_settings         set organization_id = null;
-- update public.form_config              set organization_id = null;
-- update public.photos                   set organization_id = null;
-- update public.photo_tags               set organization_id = null;
-- update public.photo_reports            set organization_id = null;
-- update public.photo_report_templates   set organization_id = null;
-- update public.notifications            set organization_id = null;
-- update public.jarvis_conversations     set organization_id = null;
-- update public.jarvis_alerts            set organization_id = null;
-- update public.marketing_assets         set organization_id = null;
-- update public.marketing_drafts         set organization_id = null;
-- update public.job_activities           set organization_id = null;
-- update public.job_adjusters            set organization_id = null;
-- update public.job_custom_fields        set organization_id = null;
-- update public.job_files                set organization_id = null;
-- update public.invoice_line_items       set organization_id = null;
-- update public.line_items               set organization_id = null;
-- update public.emails                   set organization_id = null;
-- update public.email_attachments        set organization_id = null;
-- update public.email_signatures         set organization_id = null;
-- update public.contract_signers         set organization_id = null;
-- update public.contract_events          set organization_id = null;
-- update public.photo_tag_assignments    set organization_id = null;
-- update public.photo_annotations        set organization_id = null;
