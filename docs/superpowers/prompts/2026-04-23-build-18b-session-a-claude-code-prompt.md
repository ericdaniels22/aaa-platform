# Claude Code Prompt — Build 18b, Session A (Preparation)

**Session:** A of 3 (Preparation)
**Mode:** Prep only. No prod DDL/DML. No pushes to main.
**Branch:** `18b-prep`

---

## Your role in this session

You are the **preparation phase** of Build 18b. Your job is to author all migrations, perform the code sweep, write the rollback script, and produce a handoff report — all on a feature branch, with zero changes to prod and zero pushes to main.

Sessions B (scratch rehearsal) and C (production apply) are separate sessions. They do not happen in this prompt. When this prompt is complete, you hand off cleanly for Eric to review before Session B is scheduled.

---

## Authoritative source of truth

The plan for 18b is committed at:

```
docs/superpowers/plans/2026-04-23-build-18b-rls-enforcement.md
```

**Read it in full before starting.** Relevant sections for Session A:
- §3 Current State — ground truth baseline (verify by query, don't trust)
- §5 Deliverables — what each migration does, and the behavioral spec for the hook function
- §6 Order of Operations — the sequence Session C will execute (shapes what you author)
- §11 Prompt A spec — your canonical task list
- §12 Pause & Resume Procedures — state verifiers you reference in outputs

**When this prompt and the plan conflict, the plan wins.** Raise the conflict with Eric rather than guessing.

---

## Gate boundaries (Rule C — hybrid discovery handling)

Per plan §4.3:

- **Minor (proceed):** Missing `GRANT`, typo, config key spelling, obvious permission grant, function body tweak with no semantic change. Fix and continue, note in handoff doc.
- **Material (STOP):** New migration not in the plan, change to policy semantics, any data-affecting operation, any decision about what to keep/drop/rename, discovery that prod state doesn't match §3 expectations.

When stopping on material: report to Eric with:
1. What was found
2. Proposed fix
3. Risk assessment
4. Request for approval or redirect

---

## Pre-flight: verify prod baseline

Before any work, run these queries via the Supabase MCP to confirm prod matches §3 expected state:

```sql
-- Q1: 18a baseline intact
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'tenant_isolation_%') = 56 AS tenant_iso_count_ok,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'transitional_allow_all_%') = 10 AS transitional_count_ok,
  (to_regprocedure('nookleus.active_organization_id()') IS NOT NULL) AS active_org_fn_ok,
  (to_regprocedure('nookleus.is_member_of(uuid)') IS NOT NULL) AS is_member_fn_ok,
  (to_regprocedure('public.custom_access_token_hook(jsonb)') IS NULL) AS hook_not_yet_created_ok,
  (to_regprocedure('nookleus.aaa_organization_id()') IS NOT NULL) AS aaa_helper_still_exists_ok,
  (SELECT count(*) FROM public.organizations) = 2 AS org_count_ok,
  (SELECT count(*) FROM public.user_organizations) = 1 AS member_count_ok;
```

All eight must return `true`. If any is `false`, **STOP (Rule C material)** — prod has drifted from plan. Report to Eric.

```bash
# Q2: Git state clean
git status                          # Working tree clean
git log origin/main -1 --oneline    # Latest commit should be c19278a (18a build53/54 patches)
```

Record both results in your run log. Proceed only if both queries pass.

---

## Deliverables (in order)

### 1. Branch setup

```bash
git checkout main
git pull origin main
git checkout -b 18b-prep
```

All subsequent work on `18b-prep`. Never `git push origin main` during this session.

### 2. Build the exact policy action table

Run a categorization query to partition every public-schema policy into KEEP vs DROP with reason:

```sql
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check,
  CASE
    WHEN policyname LIKE 'tenant_isolation_%' THEN 'KEEP (tenant_isolation)'
    WHEN policyname LIKE 'transitional_allow_all_%' THEN 'DROP (build57 transitional)'
    WHEN (tablename, policyname) IN (
      ('invoice_email_settings', 'invoice_email_settings_admin'),
      ('knowledge_chunks', 'Authenticated users can read knowledge chunks'),
      ('knowledge_documents', 'Authenticated users can read knowledge documents')
    ) THEN 'DROP (build56 redundant custom)'
    WHEN (tablename, policyname) IN (
      ('organizations', 'orgs_member_read'),
      ('user_organizations', 'user_orgs_member_read'),
      ('user_organizations', 'user_orgs_self_read'),
      ('user_organization_permissions', 'user_org_perms_self_read'),
      ('user_organization_permissions', 'user_org_perms_admin_manage'),
      ('user_profiles', 'Users can update own profile'),
      ('user_permissions', 'Users can view own permissions'),
      ('nav_items', 'nav_items read'),
      ('nav_items', 'nav_items_admin_write'),
      ('jarvis_alerts', 'Users can manage their own alerts'),
      ('jarvis_alerts', 'jarvis_alerts_admin_read'),
      ('jarvis_conversations', 'Users can manage their own conversations'),
      ('jarvis_conversations', 'jarvis_conversations_admin_read'),
      ('knowledge_chunks', 'knowledge_chunks_admin_manage'),
      ('knowledge_documents', 'knowledge_documents_admin_manage'),
      ('marketing_assets', 'marketing_assets_admin_manage'),
      ('marketing_drafts', 'marketing_drafts_admin_manage'),
      ('qb_connection', 'qb_connection_admin')
    ) THEN 'KEEP (custom narrow)'
    ELSE 'DROP (build57 legacy allow-all)'
  END AS action_18b
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY action_18b, tablename, policyname;
```

**Expected counts:**
- KEEP (tenant_isolation): 56
- KEEP (custom narrow): 18
- DROP (build57 transitional): 10
- DROP (build56 redundant custom): 3
- DROP (build57 legacy allow-all): 48

If any count doesn't match, **STOP (Rule C material)**. Likely a policy was added or renamed that isn't in the plan.

Save the full result set. You'll use the two DROP lists verbatim in the migrations.

### 3. Author build55 — Create `custom_access_token_hook`

**File:** `supabase/migration-build55-custom-access-token-hook.sql`

Implement per plan §5.1:

- Function signature: `public.custom_access_token_hook(event jsonb) RETURNS jsonb`
- Language: `plpgsql`
- Security: no `SECURITY DEFINER` tag (per Supabase docs recommendation — grant execute explicitly instead)
- Logic:
  1. Extract `user_id` from `event->>'user_id'` (cast to uuid)
  2. Query `user_organizations` for this user, ORDER BY created_at ASC, LIMIT 1
  3. If membership found: inject `app_metadata.active_organization_id` into `event->'claims'`
  4. If no membership: return event unmodified
  5. Wrap body in EXCEPTION WHEN OTHERS: return event unmodified (resilient, never blocks login)
- Apply grants per plan §5.1:
  - `GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin`
  - `GRANT USAGE ON SCHEMA public TO supabase_auth_admin`
  - `REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public`
  - `GRANT SELECT ON public.user_organizations TO supabase_auth_admin`

Include a `-- ROLLBACK ---` comment block at bottom with the DROP FUNCTION + REVOKE statements.

Test the function locally before committing: invoke with a fake event and verify the return payload includes the claim.

### 4. Author build56 — Drop 3 redundant custom policies

**File:** `supabase/migration-build56-drop-redundant-custom-policies.sql`

Per plan §5.5, drop:
- `invoice_email_settings_admin` on `public.invoice_email_settings`
- `"Authenticated users can read knowledge chunks"` on `public.knowledge_chunks` (note the quotes — name has spaces)
- `"Authenticated users can read knowledge documents"` on `public.knowledge_documents`

Include `-- ROLLBACK ---` section with the CREATE POLICY statements needed to restore each. Query prod to get the exact current definitions before writing the rollback.

### 5. Author build57 — Drop 48 legacy + 10 transitional policies

**File:** `supabase/migration-build57-drop-allow-all-policies.sql`

List every DROP POLICY statement **explicitly by name**. No patterns (no `DROP POLICY matching 'transitional_%'`). 58 DROP statements total, organized into two labeled sections:

```sql
-- === Section 1: 48 legacy allow-all policies ===
DROP POLICY "<policy_name>" ON public.<table_name>;
-- (repeat for all 48)

-- === Section 2: 10 transitional patches from build53 ===
DROP POLICY transitional_allow_all_qb_sync_log ON public.qb_sync_log;
-- (repeat for all 10)
```

Use the exact names from the categorization query in deliverable 2.

### 6. Author build57 rollback artifact

**File:** `supabase/build57-rollback.sql`

This file is NOT a migration (it's not applied in sequence). It's an emergency recovery artifact.

Must contain one `CREATE POLICY` statement for each of the 58 policies dropped in build57, matching the current production definition exactly. Query prod for each policy's current `qual`, `with_check`, `cmd`, and `roles`, then serialize as CREATE POLICY statements.

Structure:

```sql
-- build57 rollback — restore all 58 policies dropped in build57
-- Apply via: psql <connection> -f build57-rollback.sql
-- Only needed if Session C step 8 fails and step 9 smoke doesn't pass.

-- === Section 1: Legacy allow-all policies (48) ===
CREATE POLICY "<name>" ON public.<table> FOR <cmd> TO <roles>
  USING (<qual>) WITH CHECK (<with_check>);
-- (repeat)

-- === Section 2: Transitional patches (10) ===
-- (repeat)
```

After writing, sanity-check: this file should be the inverse of build57. If build57 drops policy X, this file creates policy X.

### 7. Author build58 — Drop `nookleus.aaa_organization_id()`

**File:** `supabase/migration-build58-drop-aaa-helper.sql`

Single DROP FUNCTION statement. Before writing, query prod for the function's current body and include it in the ROLLBACK comment section.

```sql
DROP FUNCTION IF EXISTS nookleus.aaa_organization_id();

-- ROLLBACK ---
-- CREATE OR REPLACE FUNCTION nookleus.aaa_organization_id() ...
-- <exact current body from prod>
```

### 8. Code sweep

**App-layer audit:**

Grep the `src/` tree for:
- `getActiveOrganizationId` — every definition and every call site
- `aaa_organization_id` — every reference (SQL callout or constant)
- `'a0000000-0000-4000-8000-000000000001'` — AAA UUID literal anywhere
- `nookleus.aaa_organization_id` — fully-qualified RPC calls

For `getActiveOrganizationId()`: modify to read `app_metadata.active_organization_id` from the Supabase session JWT. Fallback: return `null` if the claim is missing. **Do NOT** fall back to the AAA constant — missing claim should be a loud failure, not a silent one.

For every other AAA reference: determine if it's legitimate (e.g. a seed comment) or if it needs to be routed through `getActiveOrganizationId()` instead. Patch as needed.

**SQL trigger audit (lesson from 18a — first-class deliverable):**

Query every PL/pgSQL function in the DB:

```sql
SELECT n.nspname AS schema, p.proname AS fn_name, pg_get_functiondef(p.oid) AS body
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'nookleus')
  AND p.prokind = 'f'
  AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
ORDER BY n.nspname, p.proname;
```

For each function, inspect its body. Categorize:

- **SAFE (no org-scoped INSERTs):** Function does not INSERT into any org-scoped table.
- **SAFE (already sets organization_id):** Function INSERTs into org-scoped tables and correctly sources `organization_id` from NEW/OLD or a parent row lookup.
- **WARN (may miss organization_id):** Function INSERTs into an org-scoped table without clearly sourcing `organization_id`. Requires investigation.

For anything in WARN: **STOP (Rule C material)**. Report to Eric. Do not author a patch in Session A — that's a plan change.

**Deliverable:** `docs/superpowers/build-18b/code-sweep-report.md` with sections for:
- App-layer audit (files modified, nature of change)
- SQL trigger audit (per-function classification with count per category)
- Any WARN findings and resolution status

### 9. Run `npm run build`

Must pass cleanly. If it fails:
- If the failure is from a code-sweep edit and the fix is minor (typo, import, type): fix and continue.
- If the failure is from something else or the fix is non-trivial: **STOP (Rule C material)**. Report.

### 10. Author session-a-handoff.md

**File:** `docs/superpowers/build-18b/session-a-handoff.md`

Sections:

- **Timestamp:** When Session A completed
- **Pre-flight results:** The 8 baseline checks and git state — all TRUE
- **Policy categorization counts:** The five expected counts, actual vs expected
- **Files created:** List each migration file + rollback + reports
- **App code changes:** File-by-file summary (from code sweep report)
- **SQL trigger audit summary:** Count per category + any WARN resolution
- **Rule C triggers encountered:** If any, what and how handled
- **Ready for Session B?** Yes/No. If No: blocking issue details.

### 11. Commit & push to `18b-prep`

```bash
git add supabase/migration-build55-custom-access-token-hook.sql
git add supabase/migration-build56-drop-redundant-custom-policies.sql
git add supabase/migration-build57-drop-allow-all-policies.sql
git add supabase/migration-build58-drop-aaa-helper.sql
git add supabase/build57-rollback.sql
git add docs/superpowers/build-18b/
git add <app code files modified>
git status                          # review before commit
git commit -m "prep(18b): migrations, code sweep, rollback artifacts"
git push origin 18b-prep
```

Confirm the push succeeded. Share the GitHub PR/branch URL with Eric.

---

## Completion report

When done, report to Eric:

1. All 8 pre-flight checks passed: ✅
2. Policy categorization counts match expected: ✅
3. All four migration files authored: ✅
4. `build57-rollback.sql` authored: ✅
5. App code sweep: N files modified
6. SQL trigger audit: N functions audited, N safe, N warns
7. `npm run build`: passed
8. Branch `18b-prep` pushed to GitHub at commit `<sha>`
9. Session A handoff doc committed
10. Rule C triggers: N (details in handoff doc)
11. Ready for Session B: yes/no (with reason if no)

If any item above is anything other than a clean pass, explain what needs Eric's attention before Session B.
