# Build 18b — Session B Rehearsal Report (FINAL)

**Timestamp:** 2026-04-23 (Session B completion)
**Branch:** `18b-prep`
**Scratch project:** `prxjeloqumhzgobgfbwg` (aaa-platform-scratch-18b, us-east-2, Postgres 17.6)
**Author:** Claude Code (Session B)
**Status:** **COMPLETE — all migrations + all §8 smoke tests + rollback drill PASS. No Rule C material findings. Ready for Session C (prod).**

---

## 1. TL;DR

- All 5 18b migrations apply cleanly in plan §6 order against a prod-replica scratch DB.
- All 9 plan §8 smoke tests pass, simulated via manually-minted JWT claims (approach (b)).
- Negative cross-tenant test (Eric with forged Test Co claim) correctly returns zero rows — defense-in-depth confirmed.
- Rollback drill passes end-to-end: build57 → rollback → re-apply → final enforcement state matches first-apply state exactly.
- Two **minor** Rule C findings, both scratch-replica artifacts unrelated to prod defects. No material findings.

---

## 2. Pre-flight (§12.1 Q1 baseline against prod)

Re-ran against prod `rzzprgidqbnqcdupmpfe`. All 8 checks TRUE, identical to Session A results. Prod is in the expected state for 18b to proceed; no drift since Session A.

## 3. Session A artifact verification

- Git: `18b-prep` clean working tree at HEAD `59537e0`.
- `npm run build` — passes.
- Session A migration files all present and re-reviewed: `migration-build55/56/57/58/59-*.sql` plus `build57-rollback.sql`.
- Handoff docs present.

## 4. Scratch provisioning

- Paused 18a scratch `opbpcyxxrqzyvtzwjcsa` (Rule C minor — reversible) to free quota.
- Created scratch `prxjeloqumhzgobgfbwg` (Postgres 17.6, us-east-2, ACTIVE_HEALTHY).
- Initial replication attempt via MCP `execute_sql` hit context limits (Rule C material stop; interim report previously in this file).
- **Unblock:** Eric installed Postgres 18 client tools locally and ran `pg_dump` to replicate prod schema + seeded minimal fixtures directly into scratch. Registered as `scratch_18b_seed_fixtures` in `supabase_migrations.schema_migrations`.

## 5. Scratch state verification (post-unblock)

- 59 public tables, `nookleus` schema present with 3 functions (`aaa_organization_id`, `active_organization_id`, `is_member_of(uuid)`), `vector` extension enabled.
- Policy counts matched prod Q1 baseline: 56 `tenant_isolation_*`, 10 `transitional_allow_all_*`, 135 total public policies.
- Fixtures: Eric user (`eric@aaacontracting.com`, id `7c55cdd0-2cbf-4c8a-8fdd-e141973ade94`), AAA org (`a0000000-…0001`), Test Company org (`a0000000-…0002`), Eric is admin of AAA only, 1 seeded job (WTR-2026-0001), 1 contact, 1 contract ('sent'), 1 payment_request, 0 Test Company rows across all tenant tables. No `org_number_counters` rows (seed gap — see §11.2).

---

## 6. Migration results (plan §6 order)

Applied in order **build55 → build59 → build56 → build57 → build58**. Each registered via MCP `apply_migration` and each verified via the plan §12.3 step verifier.

| Step | Migration | Verifier | Result |
|---|---|---|---|
| §6 step 1 | **build55** — create `public.custom_access_token_hook(jsonb)` | `fn_exists && auth_admin_can_execute && auth_admin_can_read_members` | **PASS** (functional test: Eric claim injected correctly, unknown user returned unchanged, existing `app_metadata` fields preserved) |
| §6 step 2 | **build59** — patch 7 contract RPCs (`activate_next_signer`, `mark_contract_expired`, `mark_contract_sent`, `mark_reminder_sent`, `record_signer_signature`, `resend_contract_link`, `void_contract`) | `pg_get_functiondef(...) ILIKE '%INSERT INTO contract_events (organization_id%'` for each | **PASS** (functional test: `void_contract` produced event row with `organization_id` = AAA; pre-build59 would have thrown 23502 NOT NULL) |
| §6 step 2b | **build56** — drop 3 redundant custom policies (`invoice_email_settings_admin`, `Authenticated users can read knowledge chunks/documents`) | `count(*) = 0` for the 3 named policies | **PASS** |
| §6 step 8 | **build57** — drop 48 legacy allow-all + 10 transitional_allow_all_* (58 total) | `transitional_gone && legacy_allow_alls_gone` | **PASS** (135 → 74 total public policies; 56 `tenant_isolation_*` retained) |
| §6 step 10 | **build58** — drop `nookleus.aaa_organization_id()` | `to_regprocedure('nookleus.aaa_organization_id()') IS NULL` | **PASS** (`active_organization_id()` + `is_member_of(uuid)` retained) |

All 5 migrations are idempotent in-order and register correctly in `supabase_migrations.schema_migrations`.

---

## 7. §8 Smoke tests (simulated via minted JWT — approach (b))

Each smoke test executed by opening a transaction, `SET LOCAL ROLE authenticated`, `SET LOCAL "request.jwt.claims" = '{"sub": Eric's user_id, "role": "authenticated", "aud": "authenticated", "app_metadata": {"provider": "email", "active_organization_id": "a0000000-…0001"}}'`, then running the query that the route in question would issue under that auth context.

| # | Route | Simulated query | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | `/jobs` | `SELECT count(*) FROM public.jobs` as Eric | only AAA rows, no Test Co leak | 1 AAA, 0 Test | **PASS** |
| 2 | `/intake` submit | `INSERT INTO public.jobs (...) VALUES (...)` + SELECT listing | insert succeeds + visible to Eric | WTR-2026-0002 inserted; listing shows both jobs | **PASS** (required seeding `org_number_counters` — see §11.2) |
| 3 | `/photos` | `SELECT count(*) FROM public.photos` as Eric | AAA-scoped, no error | 0 AAA photos, no error | **PASS** (no fixtures, but RLS doesn't error) |
| 4 | `/contacts` | `SELECT count(*) FROM public.contacts` as Eric | AAA only | 1 AAA, 0 Test | **PASS** |
| 5 | `/settings/users` | `SELECT role FROM public.user_organizations WHERE user_id = Eric AND organization_id = AAA` as Eric | Eric as admin of AAA | `admin` | **PASS** |
| 6 | `/jarvis` | `SELECT count(*) FROM public.jarvis_conversations`, `...jarvis_alerts` as Eric | no error, returns scoped rows | 0, 0, no permission error | **PASS** |
| 7 | Incognito | same queries as `anon` role, no JWT | 0 rows everywhere | 0 jobs, 0 contacts, 0 contracts, 0 user_orgs | **PASS** |
| 8 | Service-role all-jobs | queries as `service_role` | bypass RLS; sees all rows | 2 jobs (both AAA), 1 contact, 1 contract, 1 uo | **PASS** |
| 9 | Service-role Test Co empty | service_role filtered to Test Co across 11 tenant-scoped tables | all zero | 0 jobs / contacts / invoices / contracts / contract_events / photos / payment_requests / emails / jarvis_conversations / knowledge_documents / user_organizations | **PASS** |
| Neg | Forged claim | Eric with `active_organization_id = Test Co` (not a member) | zero rows (uo-clause bars access) | 0 jobs, 0 contacts, 0 contracts | **PASS** (belt+suspenders: even if the hook were compromised, `EXISTS user_organizations` still enforces) |

**Post-Test-2 cleanup:** disposable WTR-2026-0002 deleted, counter reset to `next_value = 2`. Scratch returned to seed baseline for the rollback drill.

---

## 8. Rollback drill

Full end-to-end cycle:

| Step | Action | Policy count | Result |
|---|---|---|---|
| A | After build57 first apply | 74 public policies (56 tenant_isolation + 18 KEEP) | baseline |
| B | Apply `supabase/build57-rollback.sql` (all 58 CREATE POLICY statements via `execute_sql`) | 132 public policies (74 + 58 restored) | **PASS** — all 58 target policies present (verified by presence check against same VALUES list used pre-build57) |
| C | Post-rollback anon read | `anon` sees 1 job + 1 contact (was 0 in Test 7 under enforcement) | **PASS** — permissive semantics back |
| D | Re-apply build57 (58 DROP POLICY via `execute_sql`) | 74 public policies | **PASS** — matches Step A baseline exactly |

Rollback artifact works and its semantics are verifiable in-situ. The recovery window is well within the plan's 15-minute forward-fix budget.

---

## 9. Rule C findings

### 9.1 MINOR (noted + proceeded)

- **Paused 18a scratch `opbpcyxxrqzyvtzwjcsa`** to free Supabase quota. Reversible via `restore_project`.
- **`pg_dump --no-privileges` dropped ACLs on scratch.** Eric's unblock `pg_dump` used `--no-privileges`, so scratch initially had NULL `nspacl` on `nookleus` and NULL `relacl` on public tables. Restored on scratch with `GRANT USAGE ON SCHEMA nookleus TO authenticated, anon, service_role`, `GRANT EXECUTE ON FUNCTION nookleus.*`, and `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role`. Prod grants verified correct directly (`{postgres=UC,authenticated=U,anon=U,service_role=U}` on `nookleus`, `{postgres=arwdDxtm,anon=arwdDxtm,authenticated=arwdDxtm,service_role=arwdDxtm}` on public tables). **This is NOT a prod defect** — it's a scratch-replication artifact.
- **Fixture seed gap: `org_number_counters` empty.** The seed inserted a `jobs` row with `job_number = 'WTR-2026-0001'` but didn't pre-populate `public.org_number_counters`, so `next_job_number(AAA,'water')` produced 'WTR-2026-0001' again and collided. Seeded `(AAA, 2026, 'job', next_value=2)` and Test 2 passed. **Does not affect prod** — prod has real counter state.

### 9.2 MATERIAL (stopped for direction)

- None in this session. The interim Rule C material stop (schema replication infeasibility) was resolved by Eric's pg_dump unblock before the main work began.

---

## 10. Final state of scratch `prxjeloqumhzgobgfbwg`

- All 5 18b migrations registered in `supabase_migrations.schema_migrations`.
- Policies: 56 `tenant_isolation_*`, 0 `transitional_allow_all_*`, 74 total in public.
- Functions: `public.custom_access_token_hook(jsonb)` present; `nookleus.active_organization_id()`, `nookleus.is_member_of(uuid)` present; `nookleus.aaa_organization_id()` absent.
- Contract RPCs patched (v_org declaration + organization_id in event inserts).
- Fixtures preserved: 1 seed job (WTR-2026-0001), 1 contact, 1 contract ('sent'), 1 payment_request, Eric+AAA org membership. Counter `(AAA, 2026, 'job', 2)` set.
- ACLs restored to match prod. Disposable Test-2 insert removed.

Scratch is in the post-build58 enforcement state and can be kept for further rehearsal, or dropped whenever Eric prefers.

---

## 11. Recommendations for Session C

1. **Keep the plan §6 order intact.** All 5 migrations behaved exactly as specified in the scratch rehearsal. No reordering needed.
2. **Apply rollback within the 15-minute budget if post-build57 smoke fails.** The rollback artifact is verified-working and produces an idempotent pre-build57 state.
3. **For prod, `pg_dump --no-privileges` is NOT in the plan path** — prod already has correct grants. The grants-restore step in this rehearsal was scratch-specific and is not a Session C TODO.
4. **Before pressing the hook enable toggle in the Supabase dashboard (plan §6 step 3)**, confirm the function grants on `public.custom_access_token_hook(jsonb)` are `supabase_auth_admin` + REVOKE from everyone else. Build55's migration does this; I re-verified the ACL in scratch.
5. **Service-role paths must remain on service-role.** Test 8 confirms bypass. Any route that currently uses an anon key and expects to see cross-tenant rows will break under enforcement — but the Session A code sweep report should have caught those; reconfirm before §6 step 7 smoke.

---

## 12. Ready for Session C? Yes.

- Migrations: validated.
- Smoke tests: validated (DB-layer simulation of the 9 routes + 1 negative).
- Rollback: validated end-to-end.
- No material Rule C findings.
- Scratch is in the final enforcement state and available for re-testing.

Session C can proceed against prod when Eric is ready, with the existing plan §6 step sequence and §8 smoke checklist unchanged.
