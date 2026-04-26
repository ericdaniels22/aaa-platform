# Build 64 — Handoff

**Status:** SHIPPED 2026-04-26
**Branch:** `build64-fix` → merged into `main`
**Plan:** [docs/superpowers/plans/2026-04-26-build-64-handle-new-user-trigger.md](../plans/2026-04-26-build-64-handle-new-user-trigger.md)
**Surface area:** 1 migration, 1 rollback, 1 manual orphan deletion. Zero app-code changes.

---

## 1. Summary

Build 64 restored the `on_auth_user_created` trigger on `auth.users` that mirrors new auth users into `public.user_profiles`. The function `public.handle_new_user()` already existed (rewritten in build48); only the `AFTER INSERT` trigger calling it was missing — a latent regression that surfaced during 18c Session C step 15 as a `user_organizations_user_id_profile_fkey` FK violation when inviting via `/settings/users`.

The fix is one idempotent `CREATE OR REPLACE TRIGGER` statement plus deletion of one orphaned `auth.users` row (`eric@testtesttest.com`) left over from the failed 18c invite attempt. No application code was touched.

## 2. Pre-state (verified 2026-04-26 via Supabase MCP)

| Check | Value |
|---|---|
| `pg_trigger` rows for `on_auth_user_created` | **0** (the bug) |
| `public.handle_new_user()` exists | YES — body matches build48 |
| `auth.users` count | 2 |
| `public.user_profiles` count | 1 |
| `public.user_organizations` count | 2 |
| Orphans (auth.users without profile) | 1 |
| Orphan `7329adc0-f12a-4fb6-8463-c4171a6abdad` present | YES |

### Orphan row snapshot (captured before cleanup)

| Field | Value |
|---|---|
| `id` | `7329adc0-f12a-4fb6-8463-c4171a6abdad` |
| `email` | `eric@testtesttest.com` |
| `created_at` | 2026-04-26 07:27:32.407355+00 |
| `email_confirmed_at` | 2026-04-26 07:27:32.436886+00 |
| `confirmed_at` | 2026-04-26 07:27:32.436886+00 |
| `last_sign_in_at` | NULL |
| `raw_app_meta_data` | `{"provider":"email","providers":["email"]}` |
| `raw_user_meta_data` | `{"role":"crew_member","full_name":"Eric Testerson","email_verified":true}` |
| `role` | `authenticated` |
| `aud` | `authenticated` |
| `has_password` | true |
| `phone` / `phone_confirmed_at` | NULL / NULL |
| `banned_until` / `deleted_at` | NULL / NULL |
| `is_anonymous` | false |

This row had no `user_profiles` record and no `user_organizations` membership — consistent with the trigger having been missing at insert time. Safe to delete.

### `public.handle_new_user()` definition (unchanged)

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into public.user_profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$function$
```

## 3. Applied SQL

### Migration: `supabase/migration-build64-recreate-handle-new-user-trigger.sql`

```sql
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO orphan_count
    FROM auth.users au
    LEFT JOIN public.user_profiles up ON up.id = au.id
   WHERE up.id IS NULL;

  IF orphan_count > 0 THEN
    RAISE NOTICE 'build64: % auth.users row(s) lack a user_profiles row. ...', orphan_count;
  END IF;
END$$;
```

### Rollback: `supabase/build64-rollback.sql`

```sql
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
```

### Trigger verified post-apply

```
tgname:     on_auth_user_created
table:      auth.users
tgenabled:  O
definition: CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE FUNCTION handle_new_user()
```

(`pg_get_triggerdef` strips the `public.` schema qualifier; the trigger calls `public.handle_new_user`.)

### Orphan cleanup

Method: Eric deleted via Supabase Dashboard → Authentication → Users → trash icon. Plan §9 locked decision #3 forbade raw SQL on `auth.users` because Supabase Auth manages auxiliary tables (identities, sessions, MFA factors) that don't cascade safely from public-schema deletes.

## 4. Post-state (verified via Supabase MCP)

| Check | Expected | Actual |
|---|---|---|
| Trigger `on_auth_user_created` enabled on `auth.users` | YES | YES (`tgenabled = 'O'`) |
| `auth.users` count | 1 | 1 |
| `user_profiles` count | 1 | 1 |
| `user_organizations` count | 2 | 2 (Eric's AAA + TestCo memberships) |
| Orphans | 0 | 0 |
| Orphan `7329adc0...` removed | YES | YES |

## 5. Verification — invite regression (§5.4)

Per plan §6 step 6 / §5.4, Eric ran the end-to-end invite check on prod:

1. Opened `/settings/users` ✅
2. Invited `eric+build64-test@aaacontracting.com` (name "test test", role crew_member, phone 5345435435) ✅
3. API returned 201 OK — **no FK violation** ✅
4. New user appeared in `/settings/users` ✅
5. MCP query confirmed `has_profile = true` (the trigger fired and `user_profiles` was auto-populated) ✅

Direct DB evidence of the trigger firing:

```
id            a884d7e0-4cb3-4a2f-b4c0-bbeea4114eee
email         eric+build64-test@aaacontracting.com
auth_created  2026-04-26 22:18:36.075991+00
has_profile   true
full_name     test test
role          crew_member
is_active     false
organization  AAA Disaster Recovery
```

The trigger fix is verified by this database evidence: `has_profile = true` proves `handle_new_user()` ran, and the successful `user_organizations` insert proves the FK chain (`auth.users` → `user_profiles` → `user_organizations`) is intact again.

The test user was deleted via Supabase Dashboard after verification (final post-state above).

## 6. Material findings (Rule C)

### Material finding 1 — invite route does not send any email

[src/app/api/settings/users/route.ts:94](../../src/app/api/settings/users/route.ts) calls `service.auth.admin.createUser({ email, email_confirm: true, ... })`. This pre-confirms the email but **does not trigger an invitation email send**. To send a magic link, the route would need `service.auth.admin.inviteUserByEmail()` or `generateLink({ type: 'invite' })` + Resend.

This means plan §5.4 step 5 ("Confirms invitation email is sent") and step 6 ("Sign up via magic link") could not be executed as written. The trigger fix was instead verified by direct database evidence (above).

This is **not a build64 regression** — the route never sent an email. It's a pre-existing limitation surfaced during verification.

### Material finding 2 — no signup / magic-link / forgot-password flow exists

[src/app/login/page.tsx](../../src/app/login/page.tsx) is email + password only (`supabase.auth.signInWithPassword`). The `/api/settings/users` POST route also doesn't set a password on the new auth user. Combined, this means even with the trigger restored and an email sent, an invited user would have **no path to actually sign in**.

### Material finding 3 — user deletion is blocked by FK RESTRICT once a user has an active membership

Discovered when Eric tried to delete the post-verification test user via the Supabase Dashboard. The dashboard returned "Database error deleting user."

The cause: `public.user_organizations.user_id` REFERENCES `auth.users(id) ON DELETE RESTRICT`. As soon as the route inserts the membership row (which it does immediately after `auth.admin.createUser`), the auth user has a child row in `user_organizations` that prevents `ON DELETE` from succeeding.

FK chain (from the post-build64 schema):

```
auth.users
  ← user_profiles            ON DELETE CASCADE
  ← user_organizations       ON DELETE RESTRICT  ← blocks dashboard delete
user_profiles
  ← user_permissions         ON DELETE CASCADE
  ← user_organizations       ON DELETE RESTRICT  ← also blocks
user_organizations
  ← user_organization_permissions  ON DELETE CASCADE
  ← notification_preferences        ON DELETE CASCADE
```

Workaround used for the test cleanup: Eric ran one tightly-scoped `DELETE FROM public.user_organizations WHERE user_id = '<test_user_id>'` via Supabase MCP first (which cascaded `user_organization_permissions` and `notification_preferences`), then retried the dashboard delete (which then cascaded `user_profiles` → `user_permissions` and the `auth.*` tables).

This means today, **no user with an active membership can be deleted via the Supabase Dashboard alone.** That's a UX gap — fine for build64 which doesn't change app code, but build65's invite-flow work should pair with a "remove from organization" flow that handles membership deletion before (or instead of) deleting the underlying auth user. Plausible designs:

- Soft-delete: flip `is_active = false` on the membership instead of deleting the user. Dashboard delete remains for permanent removal once memberships are explicitly cleared.
- New `/settings/users/[id]/remove` endpoint: deletes the membership + permissions for the active org, leaves the auth user intact (they may still belong to other orgs).
- Hard-delete admin tool: an admin-only endpoint that deletes memberships across all orgs and then calls `auth.admin.deleteUser` — only safe with explicit confirmation.

### Resolution — deferred to build65

Per Rule C, all three findings stop and hand back to Eric. Eric chose **option A** (ship build64 trigger-fix as scoped, queue the full invite-flow feature as build65). Build65 will need its own brainstorming + plan + design covering:

- Invite email mechanism (Supabase Auth built-in invite vs. custom Resend template)
- Auth callback / set-password / magic-link landing page
- Resend-invite button + endpoint on `/settings/users`
- Possible `user_invite_email_settings` table matching the `contract_email_settings` pattern
- User-deletion UX that handles the `user_organizations` RESTRICT chain (per material finding 3 above)

Build64 ships with its locked decision #4 ("no app code changes") intact; success criterion #8 ("no Vercel redeploy needed") holds — the diff is supabase/-only.

## 7. Minor findings (logged, not blocking)

- Migration filename followed project convention `migration-build<NN>-<name>.sql` rather than the plan's literal `build<NN>-<name>.sql`. Eric chose this explicitly (option A) to match every prior migration file. Rollback file kept the existing `build<NN>-rollback.sql` convention. No functional impact.
- Worktree branch was renamed from `claude/compassionate-meninsky-7b81da` to `build64-fix` to match the plan.

## 8. Success criteria — final check

Per plan §11:

- [x] Trigger `on_auth_user_created` exists on `auth.users`, enabled, calling `public.handle_new_user()`
- [x] `auth.users` count = 1, `user_profiles` count = 1, no orphans
- [x] `/settings/users` invite for a new test email returned 201 OK
- [x] Newly-invited user had a matching `user_profiles` row (created by the trigger) and a `user_organizations` row (created by the route)
- [x] Test invite user deleted post-verification
- [x] `supabase/migration-build64-recreate-handle-new-user-trigger.sql` and `supabase/build64-rollback.sql` committed on main
- [x] `docs/superpowers/build-64/handoff.md` committed on main
- [x] No Vercel redeploy was needed (proves zero app-code coupling — confirmed by supabase/-only diff)

## 9. Rollback (if ever needed)

Run [supabase/build64-rollback.sql](../../supabase/build64-rollback.sql) — drops the trigger only. Function and any newly-created `user_profiles` rows are left intact.

The orphan deletion is one-way (Supabase Auth doesn't keep a trash). The orphan capture in §2 above is the snapshot needed to manually recreate the row via `service.auth.admin.createUser` + setting the same `id` if recovery were ever needed. That recovery is gnarly and should not be attempted casually.

## 10. What this unblocks

- **Build 65 — Invite-flow feature** (email send + signup callback + resend button + UI). Now has a clean DB foundation: `auth.users` insert reliably mirrors into `user_profiles`, so the build65 design can focus on the email/UX layer without database concerns.
- **Build 65 — Mobile platform** (Capacitor) once the invite flow is real.

---

*End of build64 handoff.*
