-- Build 18a (build52) — Backfill empty strings into auth.users token columns.
--
-- GoTrue (Supabase auth) scans these columns into Go strings and panics on
-- NULL with: "Scan error on column index 3, name 'confirmation_token':
-- converting NULL to string is unsupported". The four columns affected are
-- confirmation_token, recovery_token, email_change_token_new, email_change.
-- All four must be empty string ('') for users who have no pending action.
--
-- How this happened:
--   The build42-43 seed script inserted Eric's auth.users row with only the
--   columns it cared about (id, email, encrypted_password, role, etc) and
--   relied on column defaults for the rest. These four token columns have
--   NO database default, so they came in NULL — which is a fine SQL value
--   but explodes GoTrue's row scan because the Go struct field is `string`,
--   not `*string`.
--
--   Newly-signed-up users go through GoTrue's createUser path which sets
--   these to '' explicitly, so the bug only bites SQL-seeded rows.
--
-- Symptom:
--   POST /auth/v1/token returns 500 "Database error querying schema". The
--   browser /login form silently fails (no toast, no error in console)
--   because the SDK swallows the 500 response. /admin/users (used by the
--   service-role admin API) returns 500 "Database error finding users".
--
-- Caught by: scratch rehearsal smoke test (2026-04-22). Eric's sign-in on
--   localhost:3000/login appeared to do nothing; tracing back via the
--   Supabase auth service logs surfaced the scan error.
--
-- Depends on: build42 (which created the seed user row).
--
-- Revert: not applicable — empty string is the correct value. Reverting to
--   NULL re-introduces the GoTrue panic.

update auth.users
   set confirmation_token        = coalesce(confirmation_token,        ''),
       recovery_token            = coalesce(recovery_token,            ''),
       email_change_token_new    = coalesce(email_change_token_new,    ''),
       email_change              = coalesce(email_change,              '')
 where confirmation_token        is null
    or recovery_token            is null
    or email_change_token_new    is null
    or email_change              is null;
