---
table: emails
type: supabase
created_in: build-12
related_builds: ["[[build-12]]", "[[build-13]]", "[[build-27]]", "[[build-28]]", "[[build-18a]]"]
---

#data-source #area/email

# `emails`

IMAP-synced email rows. Created in [[build-12]]; categorization added in [[build-27]]/[[build-28]].

## Created in

- [supabase/schema-email.sql](../../../supabase/schema-email.sql) — `email_accounts`, `emails`, `email_drafts`, `email_attachments`.
- [supabase/migration-build12.sql](../../../supabase/migration-build12.sql) — initial email schema variant.
- [supabase/migration-build13.sql](../../../supabase/migration-build13.sql), [supabase/migration-build13-attachments.sql](../../../supabase/migration-build13-attachments.sql) — attachments tables and `email-attachments` storage bucket.

## Altered by

- **[[build-27]]** — `category` column (default `'general'`), `category_backfill_completed_at` on `email_accounts`, `category_rules` table (sender_domain / sender_address / subject_pattern matchers).
- **[[build-28]]** — `body_pattern` rule type for `category_rules`; required IMAP header re-fetch for backfill (text body wasn't pulled originally).
- **[[build-18a]]** — `organization_id`.

## RLS

- **18b:** `tenant_isolation_emails` (and the same on `email_accounts`, `email_drafts`, `email_attachments`, `category_rules`).

## Used by

`/email` (inbox UI), email sync (`/api/email/sync`), bulk actions (`/api/email/bulk`), counts/list/thread/send/drafts API routes, IconRail + CategoryTabs, job-email matching (`matchEmailToJob` synchronous with pre-loaded cache), invoice attach flow ([[build-16d]]).
