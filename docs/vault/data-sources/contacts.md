---
table: contacts
type: supabase
created_in: build-1-10
related_builds: ["[[build-1-10]]", "[[build-18a]]"]
---

#data-source #area/jobs

# `contacts`

Customers, adjusters, property managers, tenants. Created in [[build-1-10]].

## Created in

- [supabase/schema.sql](../../../supabase/schema.sql) — `id`, `first_name`, `last_name`, `phone`, `email`, `role` (CHECK: `homeowner`, `tenant`, `property_manager`, `adjuster`, `insurance`), `company`, `notes`.

## Altered by

- **[[build-18a]]** — `organization_id` (build43 nullable → build44 backfill → build45 NOT NULL + FK → build46 unique index rework).

## RLS

- **18b:** `tenant_isolation_contacts` keyed on `organization_id`.

## Used by

`/contacts` page, intake form, jobs (via FK reference), email contact-match, contract signers (via reference), Jarvis context.
