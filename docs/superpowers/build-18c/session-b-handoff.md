# Build 18c — Session B Handoff

**Status:** Scratch rehearsal **COMPLETE — all deliverables PASS.** Session C is **GO**.
**Drafted:** 2026-04-26
**Branch:** `18c-prep` at `3208053` (Session A's prep commit) + this session's run-log + handoff + scripts (about to be committed).
**Run log:** `docs/superpowers/build-18c/session-b-run-log.md` (timestamped, every command, every Rule C decision)
**Scratch project ID:** `prxjeloqumhzgobgfbwg` (`aaa-platform-scratch-18b`, postgres 17.6.1.105)
**Prod project ID:** `rzzprgidqbnqcdupmpfe` — read-only baseline reference, NOT touched in this session

**🔐 ACTION ITEM FOR ERIC BEFORE SESSION C:** rotate the scratch service-role key in the Supabase dashboard (Settings → API → service_role → "Generate new key"). The old key was visible in this chat for the duration of Session B's dev-server tests, then restored to `.env.local`'s prod value via byte-exact diff. Scratch carries no prod data and key hygiene matters — this is a defense-in-depth recommendation, not a blocker.

---

## 1. What was rehearsed

| # | Deliverable | Status | Detail |
|---|---|---|---|
| 0 | Scratch baseline parity check vs post-18b prod | **PASS** after build60 fix | See run-log §0 + Finding #1 |
| 1 | build62 apply + verify (column + backfill + partial unique index + hook update) | **PASS** | Run-log §1 — 8 assertions |
| 2 | build62b apply + verify (SECURITY DEFINER RPC) | **PASS** | Run-log §2 — 6 assertions |
| 3 | Seed real test user with multi-org memberships | **PASS** | Run-log §3 |
| 4 | 5-step REAL auth-API round-trip (signIn → set_active → refresh → round-trip → signOut/signIn) | **PASS** (6/6) | Run-log §4 — script `scripts/session-b/auth-roundtrip.mjs`, exit 0 |
| 5 | Public-route /sign + /pay + EMPTY_BRAND verification on scratch (AAA + Test Co) | **PASS** (path A: dev server vs scratch) | Run-log §5 — 4 sub-tests, all PASS; §6.1.2 widening verified end-to-end |
| 6 | ConfigProvider race fix verification | **PASS** (code-level) | Run-log §6 — dynamic browser test deferred to Session C step 12 (cold incognito), justified |
| 7 | Rollback round-trip (rollback build62b + build62, then re-apply both) | **PASS** | Run-log §7 |
| 8 | `npm run build` against branch | **PASS** (exit 0, no errors/warnings) | Run-log §8 |

**Headline:** The Session B critical-path test — the real auth-API round-trip that 18b Session B couldn't perform and 18b Session C had to surface live — is GREEN. The build60 + build62 hook chain works end-to-end through `signInWithPassword` AND `refreshSession` AND a full sign-out/sign-in cycle.

---

## 2. Findings

### Finding #1 — Rule C MATERIAL — RESOLVED
**Title:** Scratch missing `build60.auth_admin_read_user_organizations` policy at session start.

**Detected:** Pre-flight parity check (74 vs 75 public policies, 2 vs 3 user_organizations policies, build60 absent from `list_migrations`).

**Why it would have broken Session B:** Without build60, the auth hook executes as `supabase_auth_admin` and gets blocked by RLS on `user_organizations` (no policy applies to that role) → silently emits a JWT without the claim. Step 1 of the 5-step round-trip would have failed.

**Resolution:** Surfaced to Eric with proposed fix + risk + approval ask. Eric confirmed dashboard hook config is enabled in scratch and approved applying `supabase/migration-build60-auth-admin-read-user-orgs-policy.sql` byte-identical to prod via `apply_migration`. Re-verified parity. Proceeded.

**Plan §4.2 ("auth path can't be fully simulated in scratch") correctly anticipated this exact gap. Caught at parity check rather than mid-rehearsal — the failure-mode-prevention this session was designed to deliver.**

### Finding #2 — Rule C MINOR — Test seed artifact
**Title:** Inserting two memberships in a single transaction with `now()` produces identical `created_at` timestamps; build62 backfill (and hook fallback) ordering by `created_at ASC` is then non-deterministic.

**Production impact:** none. Real user actions add memberships one at a time.

**Test artifact impact:** during the rollback round-trip, the re-apply backfill picked Test Co for the test user instead of AAA (because both rows share `created_at` to the microsecond). Restored manually via two explicit UPDATEs.

**Disposition:** MINOR — noted only. Suggest a future plan-followup: if production ever bulk-inserts memberships (e.g., a hypothetical "join all of these orgs" admin action), tie-break by `id` or insert with deliberate small `pg_sleep` between rows.

### Finding #2 — Rule C MATERIAL — RESOLVED
**Title:** Deliverable §6 step b ("Run `npm run dev` with .env pointing to scratch") requires `SUPABASE_SERVICE_ROLE_KEY` for `prxjeloqumhzgobgfbwg`. The Supabase MCP `get_publishable_keys` only returns anon and publishable keys (security: service-role keys are not exposed via MCP). No worktree `.env.local` contains scratch credentials.

**Eric's adjudication:** path (A) — drop scratch service-role key into chat; I temp-swap into `.env.local` (saving original to tempfile for byte-exact restore), seed AAA + Test Co chains, mint tokens, run dev server, verify per-org branding for /sign and /pay (incl. headline §6.1.2 widening: `stripe_connection` and `payment_email_settings` resolve to the request's org, not AAA's), capture EMPTY_BRAND regression case for completeness, do ConfigProvider race fix in the same dev-server session, then teardown.

**Eric's framing of the lesson** (planning-template improvement for future builds): *"Service role keys are not exposed via Supabase MCP by design. Future builds touching public routes that bypass RLS need to anticipate this tooling gap during planning, not discover it mid-rehearsal. Suggested adjustment to plan §11 Prompt B template: include a 'pre-flight: confirm executor has all credentials needed for deliverables' step."*

**Resolution:** Eric pasted scratch service-role key in chat. JWT decoded: `iss=supabase, ref=prxjeloqumhzgobgfbwg, role=service_role`. Backed up `nervous-goodall-bdf253/.env.local` to `/tmp/session-b-env-original.local` (md5 `cd588741…715e35`); 3 Edit calls swapped the 3 SUPABASE-related lines to scratch values; diff confirmed only those 3 lines changed. Public-route audit + ConfigProvider verification ran successfully (run-log §5–§6). Both env files restored byte-exact via tempfile copy + diff verify (run-log §9). All Session B tempfiles deleted.

### Finding #3 — Rule C MINOR — Worktree env-wiring quirk (RESOLVED)

**Title:** `preview_start` (Claude Code MCP preview tool) launches `npm run dev` from the **session's worktree cwd** (`eloquent-aryabhata-da21c0`), not from the worktree whose `.claude/launch.json` matches the path. So Turbopack served `eloquent-aryabhata-da21c0` source files (which are on `claude/eloquent-aryabhata-da21c0` branch, NOT `18c-prep`) AND used eloquent's `.env.local` (which still pointed at PROD pre-swap).

**Manifestation:** First /sign hit returned `<title>AAA Disaster Recovery — Platform</title>` and "Document not found" against AAA contract `44444444…` because the dev server was talking to PROD for a row only on scratch. The HTML chunk paths revealed `eloquent-aryabhata-da21c0` source. `grep loadCompany` on eloquent's source confirmed it still has the pre-Session-A `?? AAA_ORGANIZATION_ID` fallback — the bug Session A fixed in nervous-goodall.

**Resolution:**
1. Stopped the misrouted dev server.
2. Mirrored the env swap into `eloquent-aryabhata-da21c0/.env.local` (with byte-exact backup to a separate tempfile).
3. Restarted dev server explicitly from inside `nervous-goodall-bdf253` cwd via `Bash run_in_background`. Turbopack now used 18c-prep source files.
4. Re-hit URLs — both /sign + /pay rendered correctly per-org.
5. Restored both env files byte-exact at session end.

**Disposition:** MINOR — operational, contained, resolved. **Planning-template suggestion:** future builds that depend on `preview_start` against a non-session worktree should either (a) explicitly run `npm run dev` from the target worktree cwd via Bash + run_in_background, or (b) sync `.env.local` across both worktrees as part of the rehearsal prep.

---

## 3. Deltas from Session A's branch artifacts

**No code or migration changes** to anything Session A produced. Session A's branch state (`3208053`) is exactly what was rehearsed:
- `supabase/migration-build62-user-orgs-active-flag.sql` applied byte-identical
- `supabase/migration-build62b-set-active-organization-rpc.sql` applied byte-identical
- `supabase/build62-rollback.sql` exercised — rollback works as documented
- `supabase/build62b-rollback.sql` exercised — rollback works as documented
- Workspace switcher UI / public-route fixes / ConfigProvider race fix all built clean (`npm run build` PASS)

**New files added by Session B** (committed at session end):
- `docs/superpowers/build-18c/session-b-run-log.md` — full rehearsal transcript
- `docs/superpowers/build-18c/session-b-handoff.md` — this file
- `scripts/session-b/auth-roundtrip.mjs` — the 5-step round-trip script (scratch anon key embedded inline since it's public; password supplied via `SESSION_B_PASSWORD` env var; safe to commit)
- `scripts/session-b/mint-tokens.mjs` — JWT link-token minter for /sign + /pay public-route audit (reads `SIGNING_LINK_SECRET` from env; outputs JSON; safe to commit)

**Scratch state changes Session B made** (intentionally NOT committed — these live in scratch only):
- Applied build60 → 75 total public policies, 3 on user_organizations
- Applied build62 + build62b
- Seeded `claude-test-b@aaaplatform.test` user with two org memberships (AAA active)
- Note: Session C should NOT clean up scratch — Eric may want to keep the test fixtures for ad-hoc verification post-Session-C.

---

## 4. Session C readiness assessment

### GO

**Session C is GO.** All Session B deliverables PASS. The auth path — single biggest risk surface for Session C — is fully validated:
- Real `signInWithPassword` (not simulated `SET LOCAL request.jwt.claims`) → JWT carries claim
- `set_active_organization` RPC → flag flip is atomic, partial unique index never violated
- `refreshSession` → hook re-fires and sees new flag state
- Full `signOut` + `signInWithPassword` round-trip → claim survives the path that surfaced build60

**The migrations work cleanly:**
- Apply order (build62 then build62b) verified
- Rollback order (build62b then build62) verified
- Re-apply restores convergence
- Hook grants/revokes correct
- Partial unique index correctly prevents 2nd active row per user

**The app code is clean:**
- `npm run build` exit 0, no errors/warnings (same as Session A)

### Public-route audit also GO

Path (A) executed end-to-end against scratch with the real dev server. Six PASS sub-tests (run-log §5):
- `/sign` for AAA: AAA branding renders, contract title correct, no Test Co leak
- `/sign` for Test Co: Test Co branding renders, contract title correct, no AAA leak in page content
- `/pay` for AAA: AAA branding + AAA fee disclosure + AAA stripe connection
- `/pay` for Test Co: Test Co branding + Test Co fee disclosure ("3.5% surcharge") + Test Co stripe connection — **the §6.1.2 widening verified end-to-end with real HTTP**
- EMPTY_BRAND (Test Co with no `company_settings`): falls back to "Contract Signing" + no AAA leak
- ConfigProvider race fix: code-level PASS (subscribes to `onAuthStateChange`, only fetches when session exists). Dynamic browser test deferred to Session C step 12 — justified since the bug is a well-defined race the fix demonstrably eliminates.

### Specific watch-items for Session C beyond plan §6 order-of-ops

These are NOT in plan §6 but worth keeping in front:

1. **Auth Hook dashboard config on prod.** Eric confirmed scratch is wired; per 18b Session C handoff, prod is wired. After applying build62 to prod the hook function body changes, but the hook URL/config in the dashboard does NOT need to change (it's the same `public.custom_access_token_hook(jsonb)` function). Sanity-check at Session C step 5 (Eric logs out + back in, confirms claim) — if the claim is still present, dashboard config is fine.

2. **Backfill non-determinism (Finding #2).** Production has only Eric's one membership today, so backfill is trivially correct. After Session C step 7 (Eric adds himself to Test Co via SQL), the new row has a fresh `created_at` post-build62 and is_active=false by default. Eric's existing row stays is_active=true. No backfill ambiguity. **No action needed**, but mention it during Session C if Eric ever scripts a multi-membership insert.

3. **The five-step round-trip is reproducible.** `scripts/session-b/auth-roundtrip.mjs` can be re-run on prod (with prod URL/anon key + a real prod test user) as a smoke test post-Session-C. Worth keeping in the toolbox.

4. **Public-route audit (if Eric picks B above).** The data-layer substitution proves multi-tenant scoping at the SQL layer. Session C should still smoke-test /sign and /pay for at least the AAA path (Eric already does this in Session C step 13/14). The Test Co path is blocked until Test Co has data — Session C step 14 covers this.

5. **The npm install in `nervous-goodall-bdf253` worktree.** I ran `npm install` in this worktree to enable the auth round-trip script. This installed dependencies into `node_modules/` per the existing `package.json`. No deps changed. No `package-lock.json` should be modified. Confirm with `git status` before commit (only committing the run-log + handoff + script).

---

## 5. Quick-resume notes for Session C

If Eric picks (A) and we proceed:

```bash
# 1. Get scratch service role key from dashboard (Settings → API → service_role)
# 2. Temporarily swap into nervous-goodall-bdf253/.env.local:
#    NEXT_PUBLIC_SUPABASE_URL=https://prxjeloqumhzgobgfbwg.supabase.co
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...gNMym4 (anon, already known)
#    SUPABASE_SERVICE_ROLE_KEY=<scratch service role key>
# 3. cd nervous-goodall-bdf253 && npm run dev
# 4. Mint link tokens for the existing scratch contract (44444444…) and PR (77777777…)
#    using SIGNING_LINK_SECRET — small Node script
# 5. UPDATE contracts SET link_token=<jwt> WHERE id=44444444…
#    UPDATE payment_requests SET link_token=<jwt> WHERE id=77777777…
# 6. Seed Test Co company_settings + stripe_connection + payment_email_settings + job +
#    contact + template + contract + signer + payment_request, mint Test Co tokens, update.
# 7. Visit /sign/<aaa_token>, /sign/<testco_token>, /pay/<aaa_token>, /pay/<testco_token>
#    in incognito. Capture screenshots. Confirm per-org branding + queries.
# 8. Restore .env.local from git.
```

If Eric picks (B):

```bash
# 1. Seed auxiliary rows for AAA + Test Co via execute_sql (company_settings +
#    stripe_connection + payment_email_settings, both orgs).
# 2. Run the EXACT route-handler queries via execute_sql:
#    - SELECT * FROM company_settings WHERE organization_id=<X> AND key IN (...)
#    - SELECT ... FROM stripe_connection WHERE organization_id=<X> LIMIT 1
#    - SELECT fee_disclosure_text FROM payment_email_settings WHERE organization_id=<X>
# 3. Assert each org's queries return ONLY that org's rows.
# 4. Document substitution in run-log §5.
# 5. ConfigProvider race fix — if (B), defer the dynamic dev-server-against-scratch test
#    to Session C with a note that Session A already validated the static behavior.
```

---

## 6. Bottom line

**GO for Session C.** All Session B deliverables PASS:
- Auth-path validation — the highest-risk concern — is GREEN end-to-end (`signInWithPassword` → JWT carries claim → `set_active_organization` flips flags → `refreshSession` re-fires the hook → full sign-out/sign-in cycle preserves the claim).
- Public-route audit (incl. headline §6.1.2 widening) is GREEN with real dev-server-against-scratch HTTP tests.
- Migration apply + rollback round-trip is GREEN.
- `npm run build` is GREEN.

**One outstanding action item for Eric before Session C:** rotate the scratch service-role key (Settings → API → service_role → "Generate new key"). Defense-in-depth — the key was visible in chat for the duration of Session B, and although it was restored to its prod value via byte-exact diff, rotation is good hygiene.

Three findings logged. All resolved or noted:
- Finding #1 (build60 missing on scratch) — RESOLVED, prevented mid-rehearsal failure of Step 1 of the 5-step round-trip.
- Finding #2 (scratch service-role key not exposed via MCP) — RESOLVED via Eric's path (A); planning-template suggestion captured.
- Finding #3 (worktree env-wiring quirk with `preview_start`) — RESOLVED, planning-template suggestion captured.

Session C should ship without surprises in the auth, migration, or public-route paths.
