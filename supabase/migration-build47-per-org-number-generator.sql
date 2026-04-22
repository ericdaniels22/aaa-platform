-- Build 18a (build47) — Replace global job/invoice number sequences with a
-- per-org counter table. Preserves AAA's current numbering state.
--
-- Purpose:   Each tenant needs independent job/invoice counters so two
--            orgs can both have, say, a WTR-2026-0001 job.
-- Depends on: build45 (organization_id is NOT NULL on jobs + invoices).
-- Revert:    Restore original generate_job_number(text) and
--            set_invoice_number() using job_number_seq / invoice_number_seq.
--            The legacy sequences are intentionally LEFT IN PLACE so revert
--            is a pure function-replacement. See -- ROLLBACK --- block.
--
-- Counter seeds were computed at migration-write time via MCP:
--   SELECT coalesce(max(substring(job_number FROM '-(\d+)$')::int), 0)
--     FROM public.jobs WHERE job_number ~ '-\d{4}$';                  -> 13
--   SELECT coalesce(max(substring(invoice_number FROM '-(\d+)$')::int), 0)
--     FROM public.invoices WHERE invoice_number ~ '-\d{4}$';          -> 1
-- Next-value seeds = max + 1 = 14 for job, 2 for invoice. These match
-- job_number_seq.last_value=13/is_called=true (next nextval() = 14) and
-- invoice_number_seq.last_value=1/is_called=true (next nextval() = 2), so
-- no gap risk from rolled-back inserts.

-- ---------------------------------------------------------------------------
-- 1. Counter table — one row per (org, year, document_kind).
-- ---------------------------------------------------------------------------
create table if not exists public.org_number_counters (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  year int not null,
  document_kind text not null check (document_kind in ('job','invoice')),
  next_value int not null default 1 check (next_value >= 1),
  primary key (organization_id, year, document_kind)
);

-- RLS not enabled on this table — mutations happen only through the
-- number-generation functions and service-role code. If someone wants to
-- expose it to the UI later they should enable RLS then.

-- ---------------------------------------------------------------------------
-- 2. Seed AAA's counters. Derived from the SELECT queries above (max+1).
--    job:     next_value = 14 (last real job number was 13)
--    invoice: next_value =  2 (last real invoice number was 1)
-- ---------------------------------------------------------------------------
insert into public.org_number_counters (organization_id, year, document_kind, next_value)
values
  ('a0000000-0000-4000-8000-000000000001', extract(year from now())::int, 'job',     14),
  ('a0000000-0000-4000-8000-000000000001', extract(year from now())::int, 'invoice',  2)
on conflict (organization_id, year, document_kind) do nothing;

-- ---------------------------------------------------------------------------
-- 3. next_job_number(p_org, p_damage) — atomic per-org counter increment.
--    UPDATE ... RETURNING serializes concurrent callers on the row lock, so
--    no separate advisory lock needed.
-- ---------------------------------------------------------------------------
create or replace function public.next_job_number(p_org uuid, p_damage text)
returns text
language plpgsql
as $$
declare
  prefix text;
  yr int := extract(year from now())::int;
  counter int;
begin
  prefix := case p_damage
    when 'water'     then 'WTR'
    when 'fire'      then 'FYR'
    when 'mold'      then 'MLD'
    when 'storm'     then 'STM'
    when 'biohazard' then 'BIO'
    when 'contents'  then 'CTS'
    when 'rebuild'   then 'BLD'
    else 'JOB'
  end;

  insert into public.org_number_counters (organization_id, year, document_kind, next_value)
    values (p_org, yr, 'job', 1)
    on conflict (organization_id, year, document_kind) do nothing;

  update public.org_number_counters
    set next_value = next_value + 1
    where organization_id = p_org and year = yr and document_kind = 'job'
    returning next_value - 1 into counter;

  return prefix || '-' || yr || '-' || lpad(counter::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. next_invoice_number(p_org) — same atomic-counter shape.
-- ---------------------------------------------------------------------------
create or replace function public.next_invoice_number(p_org uuid)
returns text
language plpgsql
as $$
declare
  yr int := extract(year from now())::int;
  counter int;
begin
  insert into public.org_number_counters (organization_id, year, document_kind, next_value)
    values (p_org, yr, 'invoice', 1)
    on conflict (organization_id, year, document_kind) do nothing;

  update public.org_number_counters
    set next_value = next_value + 1
    where organization_id = p_org and year = yr and document_kind = 'invoice'
    returning next_value - 1 into counter;

  return 'INV-' || yr || '-' || lpad(counter::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Rewire the trigger functions. They now dispatch by organization_id.
--    Fallback to NOOKLEUS default: if a row comes in with NULL org (it
--    should not, because build45 enforces NOT NULL), raise.
-- ---------------------------------------------------------------------------
create or replace function public.set_job_number()
returns trigger
language plpgsql
as $$
begin
  if new.job_number is null or new.job_number = '' then
    if new.organization_id is null then
      raise exception 'set_job_number: organization_id must be set before insert';
    end if;
    new.job_number := public.next_job_number(new.organization_id, new.damage_type);
  end if;
  return new;
end;
$$;

create or replace function public.set_invoice_number()
returns trigger
language plpgsql
as $$
begin
  if new.invoice_number is null or new.invoice_number = '' then
    if new.organization_id is null then
      raise exception 'set_invoice_number: organization_id must be set before insert';
    end if;
    new.invoice_number := public.next_invoice_number(new.organization_id);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Keep generate_job_number(damage text) callable for any legacy code
--    path that still references it during the 18a rollout. It now requires
--    the caller to pass the org via a second overload. The old signature
--    stays but raises — intentional loud failure so we catch any straggler.
-- ---------------------------------------------------------------------------
create or replace function public.generate_job_number(damage text)
returns text
language plpgsql
as $$
begin
  raise exception 'generate_job_number(text) is deprecated — use next_job_number(p_org uuid, p_damage text) from build47';
end;
$$;

-- The old sequences (job_number_seq, invoice_number_seq) are intentionally
-- left in place so revert is a pure function-replacement. They'll be dropped
-- in a post-18a cleanup migration after we confirm no code references them.

-- ROLLBACK ---
-- Restore the original functions and drop the new ones.
--
-- create or replace function public.generate_job_number(damage text)
-- returns text language plpgsql as $$
-- declare
--   prefix text;
--   seq_num integer;
--   current_yr text;
-- begin
--   prefix := case damage
--     when 'water' then 'WTR' when 'fire' then 'FYR' when 'mold' then 'MLD'
--     when 'storm' then 'STM' when 'biohazard' then 'BIO' when 'contents' then 'CTS'
--     when 'rebuild' then 'BLD' else 'JOB' end;
--   current_yr := extract(year from now())::text;
--   seq_num := nextval('job_number_seq');
--   return prefix || '-' || current_yr || '-' || lpad(seq_num::text, 4, '0');
-- end; $$;
--
-- create or replace function public.set_job_number()
-- returns trigger language plpgsql as $$
-- begin
--   if new.job_number is null or new.job_number = '' then
--     new.job_number := generate_job_number(new.damage_type);
--   end if;
--   return new;
-- end; $$;
--
-- create or replace function public.set_invoice_number()
-- returns trigger language plpgsql as $$
-- declare
--   current_yr text; seq_num integer;
-- begin
--   if new.invoice_number is null or new.invoice_number = '' then
--     current_yr := extract(year from now())::text;
--     seq_num := nextval('invoice_number_seq');
--     new.invoice_number := 'INV-' || current_yr || '-' || lpad(seq_num::text, 4, '0');
--   end if;
--   return new;
-- end; $$;
--
-- drop function if exists public.next_job_number(uuid, text);
-- drop function if exists public.next_invoice_number(uuid);
-- drop table if exists public.org_number_counters;
