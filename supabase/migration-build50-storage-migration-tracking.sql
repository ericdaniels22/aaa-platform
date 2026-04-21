-- Build 18a (build50) — Storage migration tracking table and the swap
-- function that atomically updates every DB path column to org-prefixed form.
--
-- Purpose:   Support the scripts/migrate-storage-paths.ts rename script.
--            The script enumerates and copies objects; this file provides
--            the bookkeeping table and the atomic DB-column swap.
-- Depends on: build45 (storage columns are still present — none dropped).
-- Revert:    DROP TABLE public.storage_migration_progress; DROP FUNCTION
--            public.storage_paths_swap_to_new(). See -- ROLLBACK --- block.

-- ---------------------------------------------------------------------------
-- 1. Progress tracking table. One row per (bucket, old_path). The rename
--    script reads/writes this to be resumable: a crash mid-run leaves a
--    coherent partial state and re-invocation picks up where it left off.
-- ---------------------------------------------------------------------------
create table if not exists public.storage_migration_progress (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  old_path text not null,
  new_path text not null,
  status text not null default 'pending'
    check (status in ('pending','copied','verified','db_updated','deleted','failed')),
  error_message text,
  attempted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint storage_migration_progress_bucket_path_key unique (bucket_id, old_path)
);

create index if not exists idx_storage_migration_status
  on public.storage_migration_progress(status);

-- Not RLS-gated: only service-role touches this during the rename window.

-- ---------------------------------------------------------------------------
-- 2. storage_paths_swap_to_new() — the atomic DB-side swap invoked by the
--    rename script after Phase 3 verifies storage copies. Idempotent: the
--    NOT LIKE ({aaa}/%) guard means re-running is a no-op.
--
--    Guarded on `is not null AND <> ''` so empty strings aren't rewritten
--    to "{uuid}/". Empty means the user hasn't uploaded, not that there's
--    a path to prefix.
-- ---------------------------------------------------------------------------
create or replace function public.storage_paths_swap_to_new()
returns void
language plpgsql
as $$
declare
  aaa_id uuid := 'a0000000-0000-4000-8000-000000000001';
  prefix text := aaa_id::text || '/';
begin
  -- photos: three path columns
  update public.photos
     set storage_path = prefix || storage_path
   where storage_path is not null and storage_path <> ''
     and storage_path not like prefix || '%';

  update public.photos
     set annotated_path = prefix || annotated_path
   where annotated_path is not null and annotated_path <> ''
     and annotated_path not like prefix || '%';

  update public.photos
     set thumbnail_path = prefix || thumbnail_path
   where thumbnail_path is not null and thumbnail_path <> ''
     and thumbnail_path not like prefix || '%';

  -- email_attachments
  update public.email_attachments
     set storage_path = prefix || storage_path
   where storage_path is not null and storage_path <> ''
     and storage_path not like prefix || '%';

  -- contracts
  update public.contracts
     set signed_pdf_path = prefix || signed_pdf_path
   where signed_pdf_path is not null and signed_pdf_path <> ''
     and signed_pdf_path not like prefix || '%';

  -- contract_signers
  update public.contract_signers
     set signature_image_path = prefix || signature_image_path
   where signature_image_path is not null and signature_image_path <> ''
     and signature_image_path not like prefix || '%';

  -- photo_reports
  update public.photo_reports
     set pdf_path = prefix || pdf_path
   where pdf_path is not null and pdf_path <> ''
     and pdf_path not like prefix || '%';

  -- payment_requests
  update public.payment_requests
     set receipt_pdf_path = prefix || receipt_pdf_path
   where receipt_pdf_path is not null and receipt_pdf_path <> ''
     and receipt_pdf_path not like prefix || '%';

  -- expenses
  update public.expenses
     set receipt_path = prefix || receipt_path
   where receipt_path is not null and receipt_path <> ''
     and receipt_path not like prefix || '%';

  update public.expenses
     set thumbnail_path = prefix || thumbnail_path
   where thumbnail_path is not null and thumbnail_path <> ''
     and thumbnail_path not like prefix || '%';

  -- marketing_assets
  update public.marketing_assets
     set storage_path = prefix || storage_path
   where storage_path is not null and storage_path <> ''
     and storage_path not like prefix || '%';

  -- job_files
  update public.job_files
     set storage_path = prefix || storage_path
   where storage_path is not null and storage_path <> ''
     and storage_path not like prefix || '%';

  -- user_profiles.profile_photo_path
  update public.user_profiles
     set profile_photo_path = prefix || profile_photo_path
   where profile_photo_path is not null and profile_photo_path <> ''
     and profile_photo_path not like prefix || '%';

  -- company_settings.value for logo keys (value holds the storage path)
  update public.company_settings
     set value = prefix || value
   where key in ('logo_path','signature_logo_path')
     and value is not null and value <> ''
     and value not like prefix || '%';

  -- Mark verified rows as db_updated so Phase 5 of the rename script can
  -- proceed to delete the originals.
  update public.storage_migration_progress
     set status = 'db_updated'
   where status = 'verified';
end;
$$;

grant execute on function public.storage_paths_swap_to_new() to service_role;

-- ROLLBACK ---
-- drop function if exists public.storage_paths_swap_to_new();
-- drop table if exists public.storage_migration_progress;
