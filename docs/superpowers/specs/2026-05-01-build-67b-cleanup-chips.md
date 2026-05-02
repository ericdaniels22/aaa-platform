# Build 67b — cleanup chips (filed during SDD execution)

This doc accumulates findings flagged during 67b implementation that were deferred to a post-main-build cleanup pass. Mirrors the 67a Session 5 precedent (commits `4a85c7e` / `5c5e59d` / `cacf84c` closed I1/I2/I3 + hardening sweep after the main 30 tasks).

At end of 67b: review this list with Eric, decide which to fix in a 67b-cleanup session vs. defer to 67c+.

---

## From Task 2 code-quality review (commit `7450e6e`)

### I1 — `xactimate_code` dual-write in `convert_estimate_to_invoice`

**Location:** `supabase/migration-build67b-conversion-and-template-apply.sql` line ~132 (the line-item INSERT inside the convert RPC).

**Finding:** The INSERT writes `v_item.code` to BOTH `invoice_line_items.code` AND `invoice_line_items.xactimate_code`. Intentional dual-write to keep the legacy `xactimate_code` column populated (Build 38 era; consumed by the kept `/api/invoices/[id]/pdf` route).

**Bug shape:** After conversion, if a user edits the line item via the new builder UI (Task 19's `/api/invoices/[id]/line-items/[item_id]` PUT), only `code` is updated — `xactimate_code` diverges silently. The PDF rendering then shows stale data.

**Mitigation already planned:** 67c rewrites the PDF route to read from `code` instead of `xactimate_code`. After 67c lands, the legacy column is unused.

**Fix path (when addressed):**
- Option A: switch convert RPC to write `NULL` to `xactimate_code` (cleaner long-term; PDF-on-newly-converted-invoices renders blank in that column until 67c).
- Option B: add a Postgres trigger that mirrors `code → xactimate_code` on every insert/update (heavier but preserves the kept route's display until 67c).
- Option C: leave as-is until 67c lands and removes the column dependency.

Recommend C if 67c is imminent; A otherwise.

### I4 — `apply_template_to_estimate` doesn't recompute estimate totals inline

**Location:** Same migration file, around line 379–380 (apply-template RPC, end of function before RETURN).

**Finding:** The RPC only `UPDATE estimates SET updated_at = now()`. The route handler in Task 23 (`/api/estimates/[id]/apply-template`) calls `recalculateTotals(estimateId, supabase)` from `lib/estimates.ts` AFTER the RPC returns. Asymmetric with `convert_estimate_to_invoice`, which DOES recompute invoice totals server-side inside the RPC (lines 148–170).

**Bug shape:** Any direct invocation of the RPC (Supabase Studio, future code, manual ops) leaves the estimate's `subtotal / total / tax_amount` columns stale.

**Fix path:** Inline the same recompute math from convert RPC's lines 148–170 into apply-template before the RETURN. Makes both RPCs self-contained.

### I2 — `default_invoice_due_days` setting cast can brick conversion

**Location:** Convert RPC, lines 63–66.

**Finding:** If `company_settings.value` for `default_invoice_due_days` is malformed (e.g., `'abc'`), the `::integer` cast raises `22P02 invalid_text_representation` and the entire conversion fails. Settings are written via UI which validates, but defense-in-depth is missing.

**Fix path:** Validate at write time (settings UI) OR use a regex-safe cast in SQL.

### Minors deferred

- M3: comment in apply-template that template can't override `unit`/`code` — library-only by design.
- M8: header comment block listing all `RAISE EXCEPTION` strings + their consumers (so future maintainers don't change them and silently break route handlers).
- M4: rename `v_section_count` → `v_existing_section_count` to disambiguate from `v_section_count_out`.
- M6, M7: defensive coalesces for theoretical NULL cases.

(M1, M2, M5 too speculative or low-value to track.)

---

## (Future findings appended here as build progresses.)
