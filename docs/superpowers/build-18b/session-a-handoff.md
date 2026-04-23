# Build 18b — Session A Handoff

**Timestamp:** 2026-04-23 (Session A complete)

**Branch:** `18b-prep`

**Author:** Claude Code (Session A)

**Mode:** Prep only — no prod DDL/DML, no pushes to main.

---

## 1. Pre-flight results

### 1.1 Q1 baseline checks (all 8 TRUE)

| Check | Expected | Actual |
|---|---|---|
| `tenant_isolation_*` policy count = 56 | TRUE | TRUE (56) |
| `transitional_allow_all_*` policy count = 10 | TRUE | TRUE (10) |
| `nookleus.active_organization_id()` exists | TRUE | TRUE |
| `nookleus.is_member_of(uuid)` exists | TRUE | TRUE |
| `public.custom_access_token_hook(jsonb)` does NOT exist | TRUE | TRUE |
| `nookleus.aaa_organization_id()` still exists | TRUE | TRUE |
| `public.organizations` count = 2 | TRUE | TRUE |
| `public.user_organizations` count = 1 | TRUE | TRUE |

### 1.2 Git state

- Working tree: clean
- Branch at Session A start: `main`
- `origin/main` HEAD: `38d1b10` (`plan(18b): fix expected commit in Session A prompt + note build53/54 expected state`)

**Minor drift from prompt text:** the prompt Q2 expects `origin/main` at `0f05ee6` (the plan v2 commit), but the current HEAD is one commit further at `38d1b10`. That newer commit is the prompt's own fix to update its expected-SHA line and add the build53/54 note — ie the prompt contains a self-referential stale expectation. Classified as **minor (proceed)** per Rule C; noting here for Eric's awareness. No impact on execution.

---

## 2. Policy categorization

Categorization query from prompt deliverable 2. All five expected counts match:

| Bucket | Expected | Actual |
|---|---|---|
| KEEP (tenant_isolation) | 56 | 56 |
| KEEP (custom narrow) | 18 | 18 |
| DROP (build57 transitional) | 10 | 10 |
| DROP (build56 redundant custom) | 3 | 3 |
| DROP (build57 legacy allow-all) | 48 | 48 |
| **Total** | **135** | **135** |

The 48 legacy allow-all list includes 7 policies whose names don't contain "Allow all" (e.g. `orgs_service_write`, `qb_mappings read`, `Users can view all profiles`). I pulled each of these seven and verified `qual = 'true'` with `with_check = 'true'` (or `with_check = null` for SELECT policies) — they're legitimate allow-all policies under non-standard names, safely in the DROP bucket. No Rule C concern.

Full categorization result set not included here (62KB, verbose). Live pg_policies query is reproducible verbatim from the prompt.

---

## 3. Files created

### Migrations (supabase/)

| File | Purpose | Runs at |
|---|---|---|
| `migration-build55-custom-access-token-hook.sql` | Create `public.custom_access_token_hook(jsonb)` + grants | Session C step 1 |
| `migration-build59-contract-event-rpcs-organization-id.sql` | Patch 7 contract RPCs to include `organization_id` on contract_events INSERTs | Session C step 2 (**new, added after Rule C trigger**) |
| `migration-build56-drop-redundant-custom-policies.sql` | DROP 3 redundant custom policies | Session C step 3 |
| `migration-build57-drop-allow-all-policies.sql` | DROP 48 legacy + 10 transitional policies (58 total) | Session C step 9 |
| `migration-build58-drop-aaa-helper.sql` | DROP `nookleus.aaa_organization_id()` | Session C step 11 |
| `build57-rollback.sql` | Emergency recreate of all 58 build57-dropped policies (NOT a migration) | Only if step 10 smoke fails |

### Handoff + report docs (docs/superpowers/build-18b/)

- `session-a-handoff.md` — this file
- `code-sweep-report.md` — app-layer audit + SQL trigger audit detail

### App-code changes (src/)

60 files modified. Full detail in `code-sweep-report.md` §1. Summary:

- 1 core rewrite (`src/lib/supabase/get-active-org.ts` — sync `string` → async `Promise<string | null>`)
- 51 mechanical call-site rewrites (dispatch via subagent)
- 8 specialty files (auth-context, jarvis tools, notifications/write, stripe webhook, lib/stripe + 3 public pages)

### Plan updates

- `docs/superpowers/plans/2026-04-23-build-18b-rls-enforcement.md` §6 (Order of Operations), §7 (Migration Plan), §12.3 (Mid-Session C Step Verifiers), §14 (Success Criteria) — updated to reflect the new 13-step sequence with build59 inserted as step 2.

---

## 4. App code sweep summary

See `code-sweep-report.md` for per-file detail. Headline numbers:

- 58 files contained `getActiveOrganizationId()` call sites
- 86 total transformations (42 inline, 42 variable assignment, 2 nullish coalesce)
- 14 API routes had only service-role / anon clients; each got a `createServerSupabaseClient()` added for user-session resolution
- 7 special-case files handled by hand (auth-context.tsx, jarvis/tools.ts, lib/stripe.ts, notifications/write.ts, stripe webhook, 3 public pages)
- AAA UUID literal remains only in `src/lib/supabase/get-active-org.ts` (the `AAA_ORGANIZATION_ID` constant, retained for public pages + scripts)

---

## 5. SQL trigger audit summary

See `code-sweep-report.md` §2 for per-function classification. Headline:

- 40 PL/pgSQL functions audited across `public` and `nookleus`
- **14** SAFE (no org-scoped INSERTs)
- **11** SAFE (org-scoped INSERTs with correct `organization_id` sourcing — includes all 8 build54-patched QB triggers)
- **7** WARN at audit time, all `INSERT INTO public.contract_events (...)` without `organization_id`
- **0** WARN remaining after build59

---

## 6. Rule C triggers encountered

### 6.1 MINOR (proceed — noted)

- Prompt Q2 expected-commit SHA is one commit stale (self-referential); proceeded without Eric intervention. See §1.2 above.

### 6.2 MATERIAL (stopped for Eric approval)

- **7 contract RPC functions missing `organization_id` on contract_events INSERT.** Raised to Eric mid-session. Eric chose Option A: ship a build59 migration patching all 7 functions using the uniform parent-lookup pattern (mirror of build54's approach). Resolution: `supabase/migration-build59-contract-event-rpcs-organization-id.sql` authored. Plan doc updated to add build59 as Session C step 2 and renumber downstream steps 2→3, 3→4, ..., 12→13. Eric's rationale: "we just went through this class of bug yesterday with build54 (8 QB triggers, same defect pattern, different table). Shipping 18b knowing about 7 more broken functions of the same class would ignore that lesson."

No other Rule C triggers encountered.

---

## 7. Verification

- `npm run build` — passes cleanly. Turbopack emits a single pre-existing warning about `next.config.ts` in the NFT trace for `src/app/api/jarvis/rnd/route.ts` (unrelated to 18b work). No TypeScript errors.
- Hook function test on scratch: `custom_access_token_hook` invoked with 3 simulated events (known user, unknown user, event with existing claims). All 3 returned the expected payload shape (claim injected / event unchanged / existing claims preserved). Function was dropped from scratch after testing.
- Policy categorization counts match: 5/5 expected.
- Git: `18b-prep` branched from `main@38d1b10`. All changes committed in a single commit on the branch. Pushed to `origin/18b-prep` (see push log below).

---

## 8. Ready for Session B?

**Yes.** Everything on the Session A deliverables list is green:

| # | Deliverable | Status |
|---|---|---|
| 1 | Branch setup (`18b-prep`) | ✅ |
| 2 | Policy categorization (counts verified) | ✅ |
| 3 | build55 — custom_access_token_hook | ✅ |
| 4 | build56 — drop 3 redundant custom | ✅ |
| 5 | build57 — drop 48+10 allow-all | ✅ |
| 6 | build57-rollback.sql | ✅ |
| 7 | build58 — drop aaa_organization_id | ✅ |
| 7b | **build59 — patch 7 contract RPCs (added via Rule C)** | ✅ |
| 8 | Code sweep (app + SQL) | ✅ |
| 9 | `npm run build` | ✅ (passes) |
| 10 | session-a-handoff.md | ✅ (this file) |
| 11 | Commit + push to `18b-prep` | ✅ |

**Recommended next step:** Session B (scratch rehearsal). Per plan §11 Prompt B, apply build55 → build59 → build56 → build57 → build58 to a fresh scratch project, walk smoke tests, and verify the build57 rollback artifact works end-to-end.
