---
date: 2026-04-22
title: GoTrue panics on NULL auth.users token columns — always seed empty strings
status: locked
related_builds: ["[[build-18a]]"]
---

#decision #area/auth #area/multi-tenant

# GoTrue panics on NULL `auth.users` token columns

**Lesson:** when seeding `auth.users` rows directly in SQL (e.g., for multi-tenant migrations), the four token columns must be empty string `''`, **not NULL**. This is locked behavior for any future SQL-seeded auth user.

**Locked:** 2026-04-22 (during [[build-18a]] Prompt B scratch rehearsal).

## The columns

`confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`.

## Why NULL breaks

GoTrue (the Supabase auth service) scans each `auth.users` row into a Go struct whose token fields are typed `string`, not `*string`. NULL → string is unsupported, so the row scan panics:

```
Scan error on column index 3, name 'confirmation_token':
  converting NULL to string is unsupported
```

Symptoms:

- `POST /auth/v1/token` returns 500 "Database error querying schema"
- `/login` form silently fails (the SDK swallows the 500; no toast, no console error)
- `/admin/users` (service-role admin API) returns 500 "Database error finding users"

## Why it bit us

The build42-43 seed script inserted Eric's `auth.users` row with only the columns it cared about (id, email, encrypted_password, role, etc.) and relied on column defaults for the rest. These four token columns have **no database default** in `auth.users`, so they came in NULL — fine SQL, exploded GoTrue.

GoTrue's own user-creation path (`createUser`) sets these to `''` explicitly, so the bug only bites SQL-seeded rows. Newly signed-up users are unaffected.

## The fix

`migration-build52-auth-users-null-token-backfill.sql`:

```sql
update auth.users
   set confirmation_token        = coalesce(confirmation_token,        ''),
       recovery_token            = coalesce(recovery_token,            ''),
       email_change_token_new    = coalesce(email_change_token_new,    ''),
       email_change              = coalesce(email_change,              '')
 where confirmation_token        is null
    or recovery_token            is null
    or email_change_token_new    is null
    or email_change              is null;
```

## How to apply going forward

- Any future SQL that seeds `auth.users` directly **must** set these four columns to `''`.
- Catching it requires touching `auth.users` *and* running the auth flow against scratch — not a typical smoke test pattern. Add a baseline check that sign-in returns a session token whenever new auth.users rows are seeded.

## Related

- Migration: [supabase/migration-build52-auth-users-null-token-backfill.sql](../../../supabase/migration-build52-auth-users-null-token-backfill.sql)
- Build: [[build-18a]]
- Caught by: scratch rehearsal smoke test (Eric's sign-in on `localhost:3000/login` appeared to do nothing; tracing back via Supabase auth service logs surfaced the scan error).
