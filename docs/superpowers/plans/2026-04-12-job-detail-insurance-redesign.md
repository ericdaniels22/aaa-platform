# Job Detail — Insurance & Contact Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the job detail header into a single card with three columns (Job Info | Contact + Adjusters | Insurance + HOA), support multiple adjusters per job, and add editable insurance/HOA fields.

**Architecture:** Replace the two-card grid with a single card using a 5-column CSS grid (`1fr auto 1fr auto 1fr`) where `auto` columns are 1px dividers. A new `job_adjusters` junction table replaces the single `adjuster_contact_id` FK. New dialogs handle insurance editing and adjuster management. All changes are in the existing `job-detail.tsx` component, `types.ts`, `intake-form.tsx`, and a new migration file.

**Tech Stack:** Next.js, React, Supabase (Postgres), Tailwind CSS, shadcn/ui (Dialog, Input, Select, Button), Lucide icons

**Spec:** `docs/superpowers/specs/2026-04-12-job-detail-insurance-redesign.md`

**No test framework:** This project has no jest/vitest/playwright. Verification = `npx tsc --noEmit` + manual preview. Every commit should pass tsc.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migration-build31-insurance-redesign.sql` | Create | Schema changes: new columns, junction table, data migration |
| `src/lib/types.ts` | Modify | Update Job/Contact interfaces, add JobAdjuster |
| `src/components/job-detail.tsx` | Modify | Layout restructure, new dialogs, query changes |
| `src/components/intake-form.tsx` | Modify | Use job_adjusters instead of adjuster_contact_id |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migration-build31-insurance-redesign.sql`

This migration adds new insurance/HOA columns to jobs, creates the job_adjusters junction table, adds title to contacts, migrates existing adjuster data, and drops the old FK.

- [ ] **Step 1: Create the migration file**

Create `supabase/migration-build31-insurance-redesign.sql`:

```sql
-- Build 31: Insurance & Contact Redesign
-- Adds insurance detail fields, HOA fields, job_adjusters junction table,
-- contact title column. Migrates existing adjuster_contact_id data.

-- 1. Add new insurance + HOA columns to jobs
ALTER TABLE jobs ADD COLUMN policy_number text;
ALTER TABLE jobs ADD COLUMN date_of_loss date;
ALTER TABLE jobs ADD COLUMN deductible numeric(10,2);
ALTER TABLE jobs ADD COLUMN hoa_name text;
ALTER TABLE jobs ADD COLUMN hoa_contact_name text;
ALTER TABLE jobs ADD COLUMN hoa_contact_phone text;
ALTER TABLE jobs ADD COLUMN hoa_contact_email text;

-- 2. Add title column to contacts
ALTER TABLE contacts ADD COLUMN title text;

-- 3. Create job_adjusters junction table
CREATE TABLE job_adjusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, contact_id)
);

-- 4. Enable RLS on job_adjusters (match other tables)
ALTER TABLE job_adjusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated users" ON job_adjusters
  FOR ALL USING (true) WITH CHECK (true);

-- 5. Migrate existing adjuster_contact_id data into job_adjusters
INSERT INTO job_adjusters (job_id, contact_id, is_primary)
SELECT id, adjuster_contact_id, true
FROM jobs
WHERE adjuster_contact_id IS NOT NULL;

-- 6. Drop the old adjuster_contact_id column
ALTER TABLE jobs DROP COLUMN adjuster_contact_id;
```

- [ ] **Step 2: Run the migration against Supabase**

Use the Supabase MCP `apply_migration` tool with project ID from the environment. The migration name should be `build31_insurance_redesign` and the query is the full SQL above.

- [ ] **Step 3: Verify the migration**

Run via Supabase MCP `execute_sql`:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'jobs' AND column_name IN ('policy_number', 'date_of_loss', 'deductible', 'hoa_name', 'hoa_contact_name', 'hoa_contact_phone', 'hoa_contact_email')
ORDER BY column_name;
```

Expected: 7 rows returned.

Then verify job_adjusters table:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'job_adjusters' ORDER BY ordinal_position;
```

Expected: 5 columns (id, job_id, contact_id, is_primary, created_at).

Then verify contacts.title:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'contacts' AND column_name = 'title';
```

Expected: 1 row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-build31-insurance-redesign.sql
git commit -m "feat: add migration build31 for insurance redesign

Adds insurance detail columns (policy_number, date_of_loss, deductible),
HOA fields, job_adjusters junction table, contacts.title column.
Migrates existing adjuster_contact_id data and drops the old column."
```

---

### Task 2: Update TypeScript Types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add `title` to the Contact interface**

In `src/lib/types.ts`, the Contact interface is at lines 1-12. Add `title` after `company`:

```typescript
// In Contact interface, after line 8 (company: string | null;)
  title: string | null;
```

- [ ] **Step 2: Update the Job interface — add new fields, remove old ones**

In `src/lib/types.ts`, the Job interface is at lines 14-36. Make these changes:

After `claim_number: string | null;` (line 28), add:
```typescript
  policy_number: string | null;
  date_of_loss: string | null;
  deductible: number | null;
  hoa_name: string | null;
  hoa_contact_name: string | null;
  hoa_contact_phone: string | null;
  hoa_contact_email: string | null;
```

Remove line 29 (`adjuster_contact_id: string | null;`).

Replace line 35 (`adjuster?: Contact;`) with:
```typescript
  job_adjusters?: JobAdjuster[];
```

- [ ] **Step 3: Add the JobAdjuster interface**

After the Job interface closing brace, add:

```typescript
export interface JobAdjuster {
  id: string;
  job_id: string;
  contact_id: string;
  is_primary: boolean;
  created_at: string;
  adjuster?: Contact;
}
```

- [ ] **Step 4: Run tsc to check for type errors introduced**

Run: `npx tsc --noEmit 2>&1 | head -40`

Expected: New errors will appear in `job-detail.tsx` and `intake-form.tsx` referencing removed fields (`adjuster_contact_id`, `adjuster`). These are expected — we'll fix them in subsequent tasks. No errors in `types.ts` itself.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: update types for insurance redesign

Add JobAdjuster interface, insurance/HOA fields to Job,
title to Contact. Remove adjuster_contact_id and adjuster fields."
```

---

### Task 3: Update fetchData Query and State

**Files:**
- Modify: `src/components/job-detail.tsx:89-142`

- [ ] **Step 1: Update the Supabase query in fetchData**

In `src/components/job-detail.tsx`, at line 95, replace the select string:

Old (line 95):
```typescript
      .select("*, contact:contacts!contact_id(*), adjuster:contacts!adjuster_contact_id(*)")
```

New:
```typescript
      .select("*, contact:contacts!contact_id(*), job_adjusters(*, adjuster:contacts!contact_id(*))")
```

This loads adjusters through the junction table instead of the dropped `adjuster_contact_id` FK.

- [ ] **Step 2: Run tsc to verify the query change doesn't introduce new errors**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`

Note the count — it should be the same as after Task 2 (errors from removed fields in JSX/logic, not new ones).

- [ ] **Step 3: Commit**

```bash
git add src/components/job-detail.tsx
git commit -m "feat: update fetchData query to use job_adjusters junction table"
```

---

### Task 4: Restructure Layout to Single Card / 3 Columns

**Files:**
- Modify: `src/components/job-detail.tsx:262-379`

This replaces the two-card `grid grid-cols-2` with a single card containing a 5-column grid (content | divider | content | divider | content).

- [ ] **Step 1: Replace the two-card grid container**

Find the grid container at line 263:
```tsx
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
```

Replace it and its **entire contents** through the closing `</div>` of the grid (around line 379) with the new single-card three-column layout:

```tsx
            <div className="rounded-xl border border-border bg-card p-6 mb-6">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_1px_1fr_1px_1fr] gap-0">

                {/* Column 1: Job Info */}
                <div className="pr-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold text-foreground">Job Info</h3>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditJobOpen(true)}>
                      <Pencil size={14} className="text-muted-foreground" />
                    </Button>
                  </div>
                  <div className="space-y-3">
                    <InfoRow icon={MapPin} label="Address" value={job.property_address} />
                    {job.property_type && (
                      <InfoRow icon={Home} label="Property Type" value={
                        job.property_type === "single_family" ? "Single Family" :
                        job.property_type === "multi_family" ? "Multi Family" :
                        job.property_type === "commercial" ? "Commercial" : "Condo"
                      } />
                    )}
                    {job.damage_source && (
                      <InfoRow icon={Droplets} label="Damage Source" value={job.damage_source} />
                    )}
                    {job.affected_areas && (
                      <InfoRow icon={MapPin} label="Affected Areas" value={job.affected_areas} />
                    )}
                    <InfoRow icon={FileText} label="Intake Date" value={
                      new Date(job.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                        hour: "numeric", minute: "2-digit",
                      })
                    } />
                  </div>
                </div>

                {/* Divider 1 */}
                <div className="hidden lg:block bg-border/50" />

                {/* Column 2: Contact + Adjusters */}
                <div className="px-6 pt-6 lg:pt-0">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold text-foreground">Contact</h3>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditContactOpen(true)}>
                      <Pencil size={14} className="text-muted-foreground" />
                    </Button>
                  </div>

                  {/* Homeowner condensed card */}
                  {job.contact && (
                    <div className="rounded-lg border border-border bg-background/50 p-3 mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground">
                          {job.contact.first_name} {job.contact.last_name}
                        </span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 uppercase">
                          {job.contact.role === "property_manager" ? "Prop Manager" : job.contact.role}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[job.contact.phone, job.contact.email].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  )}

                  {/* Adjusters sub-section */}
                  <div className="flex items-center justify-between mt-4 mb-3">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Adjusters</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setAddAdjusterOpen(true)}>
                      <span className="text-primary text-lg leading-none">+</span>
                    </Button>
                  </div>

                  {(job.job_adjusters && job.job_adjusters.length > 0) ? (
                    <div className="space-y-2">
                      {job.job_adjusters
                        .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
                        .map((ja) => (
                          <AdjusterCard
                            key={ja.id}
                            jobAdjuster={ja}
                            jobId={jobId}
                            onUpdated={fetchData}
                          />
                        ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No adjusters assigned</p>
                  )}
                </div>

                {/* Divider 2 */}
                <div className="hidden lg:block bg-border/50" />

                {/* Column 3: Insurance + HOA */}
                <div className="pl-6 pt-6 lg:pt-0">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold text-foreground">Insurance</h3>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditInsuranceOpen(true)}>
                      <Pencil size={14} className="text-muted-foreground" />
                    </Button>
                  </div>

                  {/* Insurance condensed card */}
                  {(job.insurance_company || job.claim_number || job.policy_number) ? (
                    <div className="rounded-lg border border-border bg-background/50 p-3 mb-3">
                      <p className="text-sm font-medium text-foreground mb-1">
                        {job.insurance_company || "No company"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          job.claim_number && `Claim # ${job.claim_number}`,
                          job.policy_number && `Policy # ${job.policy_number}`,
                        ].filter(Boolean).join(" · ")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[
                          job.date_of_loss && `DOL: ${new Date(job.date_of_loss + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
                          job.deductible != null && `Deductible: $${Number(job.deductible).toLocaleString()}`,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic mb-3">No insurance info</p>
                  )}

                  {/* HOA sub-section */}
                  <div className="flex items-center justify-between mt-4 mb-3">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">HOA</span>
                  </div>

                  {job.hoa_name ? (
                    <div className="rounded-lg border border-border bg-background/50 p-3">
                      <p className="text-sm font-medium text-foreground mb-1">{job.hoa_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          job.hoa_contact_name && `Contact: ${job.hoa_contact_name}`,
                          job.hoa_contact_phone,
                        ].filter(Boolean).join(" · ")}
                      </p>
                      {job.hoa_contact_email && (
                        <p className="text-xs text-muted-foreground mt-0.5">{job.hoa_contact_email}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No HOA info</p>
                  )}
                </div>

              </div>
            </div>
```

- [ ] **Step 2: Add new state variables for the new dialogs**

Near the existing state declarations (around lines 59-87 where `editJobOpen`, `editContactOpen` etc. are declared), add:

```typescript
const [editInsuranceOpen, setEditInsuranceOpen] = useState(false);
const [addAdjusterOpen, setAddAdjusterOpen] = useState(false);
```

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit 2>&1 | head -40`

Expected: Errors for `AdjusterCard` (not yet defined) and `EditInsuranceDialog` / `AddAdjusterDialog` (not yet rendered). No other new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/job-detail.tsx
git commit -m "feat: restructure job detail header to single card with 3 columns

Replace two-card grid with unified card. Job Info | Contact + Adjusters | Insurance + HOA
separated by vertical dividers. Condensed card style for homeowner, insurance, and HOA."
```

---

### Task 5: AdjusterCard Component

**Files:**
- Modify: `src/components/job-detail.tsx` (add new component near InfoRow at ~line 803)

- [ ] **Step 1: Add the AdjusterCard component**

After the `InfoRow` component (around line 803), add a new `AdjusterCard` component. This needs a `JobAdjuster` import from types — ensure it's imported at the top of the file.

First, add `JobAdjuster` to the types import at line 4:
```typescript
import type { Job, JobActivity, Payment, Photo, PhotoTag, PhotoReport, Email, JobAdjuster } from "@/lib/types";
```

Then add the component after `InfoRow`:

```tsx
function AdjusterCard({
  jobAdjuster,
  jobId,
  onUpdated,
}: {
  jobAdjuster: JobAdjuster;
  jobId: string;
  onUpdated: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const adj = jobAdjuster.adjuster;
  if (!adj) return null;

  const handleSetPrimary = async () => {
    const supabase = createClient();
    // Clear all primary flags for this job
    await supabase.from("job_adjusters").update({ is_primary: false }).eq("job_id", jobId);
    // Set this one as primary
    await supabase.from("job_adjusters").update({ is_primary: true }).eq("id", jobAdjuster.id);
    setMenuOpen(false);
    onUpdated();
  };

  const handleRemove = async () => {
    const supabase = createClient();
    await supabase.from("job_adjusters").delete().eq("id", jobAdjuster.id);
    setMenuOpen(false);
    onUpdated();
  };

  return (
    <div className="rounded-lg border border-border bg-background/50 p-3 group relative">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-foreground">
          {adj.first_name} {adj.last_name}
        </span>
        <div className="flex items-center gap-1.5">
          {jobAdjuster.is_primary && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase">
              Primary
            </span>
          )}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <span className="text-muted-foreground text-xs">•••</span>
            </Button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[140px]">
                {!jobAdjuster.is_primary && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent text-foreground"
                    onClick={handleSetPrimary}
                  >
                    Set as Primary
                  </button>
                )}
                <button
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent text-destructive"
                  onClick={handleRemove}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {[adj.title, adj.company].filter(Boolean).join(" · ")}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {[adj.phone, adj.email].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Run tsc to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: `AdjusterCard` error gone. Remaining errors for `EditInsuranceDialog` and `AddAdjusterDialog` (not yet created).

- [ ] **Step 3: Commit**

```bash
git add src/components/job-detail.tsx
git commit -m "feat: add AdjusterCard component with set-primary and remove actions"
```

---

### Task 6: EditInsuranceDialog

**Files:**
- Modify: `src/components/job-detail.tsx` (add new dialog component after EditContactDialog ~line 1168)

- [ ] **Step 1: Add the EditInsuranceDialog component**

After the `EditContactDialog` component, add:

```tsx
function EditInsuranceDialog({
  open,
  onOpenChange,
  job,
  jobId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  jobId: string;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    insurance_company: "",
    claim_number: "",
    policy_number: "",
    date_of_loss: "",
    deductible: "",
    hoa_name: "",
    hoa_contact_name: "",
    hoa_contact_phone: "",
    hoa_contact_email: "",
  });

  useEffect(() => {
    if (open && job) {
      setForm({
        insurance_company: job.insurance_company || "",
        claim_number: job.claim_number || "",
        policy_number: job.policy_number || "",
        date_of_loss: job.date_of_loss || "",
        deductible: job.deductible != null ? String(job.deductible) : "",
        hoa_name: job.hoa_name || "",
        hoa_contact_name: job.hoa_contact_name || "",
        hoa_contact_phone: job.hoa_contact_phone || "",
        hoa_contact_email: job.hoa_contact_email || "",
      });
    }
  }, [open, job]);

  const update = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("jobs")
        .update({
          insurance_company: form.insurance_company || null,
          claim_number: form.claim_number || null,
          policy_number: form.policy_number || null,
          date_of_loss: form.date_of_loss || null,
          deductible: form.deductible ? parseFloat(form.deductible) : null,
          hoa_name: form.hoa_name || null,
          hoa_contact_name: form.hoa_contact_name || null,
          hoa_contact_phone: form.hoa_contact_phone || null,
          hoa_contact_email: form.hoa_contact_email || null,
        })
        .eq("id", jobId);

      if (error) throw error;

      toast.success("Insurance info updated");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to update insurance info");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Insurance & HOA</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Insurance</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Insurance Company</label>
              <Input value={form.insurance_company} onChange={(e) => update("insurance_company", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Claim #</label>
              <Input value={form.claim_number} onChange={(e) => update("claim_number", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Policy #</label>
              <Input value={form.policy_number} onChange={(e) => update("policy_number", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Deductible</label>
              <Input type="number" step="0.01" value={form.deductible} onChange={(e) => update("deductible", e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Date of Loss</label>
            <Input type="date" value={form.date_of_loss} onChange={(e) => update("date_of_loss", e.target.value)} />
          </div>

          <div className="border-t border-border/50 pt-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">HOA</p>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">HOA Name</label>
              <Input value={form.hoa_name} onChange={(e) => update("hoa_name", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Contact Name</label>
                <Input value={form.hoa_contact_name} onChange={(e) => update("hoa_contact_name", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Contact Phone</label>
                <Input type="tel" value={form.hoa_contact_phone} onChange={(e) => update("hoa_contact_phone", e.target.value)} />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-sm font-medium text-muted-foreground mb-1">Contact Email</label>
              <Input type="email" value={form.hoa_contact_email} onChange={(e) => update("hoa_contact_email", e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Render the EditInsuranceDialog in the main component**

Near the existing dialog renders (search for `<EditJobInfoDialog` and `<EditContactDialog` in the JSX return), add:

```tsx
      <EditInsuranceDialog
        open={editInsuranceOpen}
        onOpenChange={setEditInsuranceOpen}
        job={job}
        jobId={jobId}
        onSaved={fetchData}
      />
```

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: EditInsuranceDialog errors gone. `AddAdjusterDialog` still missing.

- [ ] **Step 4: Commit**

```bash
git add src/components/job-detail.tsx
git commit -m "feat: add EditInsuranceDialog for insurance + HOA fields"
```

---

### Task 7: AddAdjusterDialog

**Files:**
- Modify: `src/components/job-detail.tsx` (add new dialog component after EditInsuranceDialog)

- [ ] **Step 1: Add the AddAdjusterDialog component**

```tsx
function AddAdjusterDialog({
  open,
  onOpenChange,
  jobId,
  existingAdjusterIds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  existingAdjusterIds: string[];
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"search" | "create">("search");
  const [saving, setSaving] = useState(false);

  // Search mode state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);

  // Create mode state
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    title: "",
    company: "",
    phone: "",
    email: "",
  });

  useEffect(() => {
    if (!open) {
      setMode("search");
      setSearchQuery("");
      setSearchResults([]);
      setForm({ first_name: "", last_name: "", title: "", company: "", phone: "", email: "" });
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (mode !== "search" || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearching(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("contacts")
        .select("*")
        .eq("role", "adjuster")
        .or(`first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,company.ilike.%${searchQuery}%`)
        .limit(10);
      setSearchResults((data || []).filter((c) => !existingAdjusterIds.includes(c.id)));
      setSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, mode, existingAdjusterIds]);

  const handleLinkExisting = async (contactId: string) => {
    setSaving(true);
    try {
      const supabase = createClient();
      // If no adjusters yet, make this one primary
      const isPrimary = existingAdjusterIds.length === 0;
      const { error } = await supabase.from("job_adjusters").insert({
        job_id: jobId,
        contact_id: contactId,
        is_primary: isPrimary,
      });
      if (error) throw error;
      toast.success("Adjuster added");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to add adjuster");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNew = async () => {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast.error("First and last name are required");
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      // Create the contact
      const { data: contact, error: contactErr } = await supabase
        .from("contacts")
        .insert({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          title: form.title || null,
          company: form.company || null,
          phone: form.phone || null,
          email: form.email || null,
          role: "adjuster",
        })
        .select()
        .single();
      if (contactErr) throw contactErr;

      // Link to job
      const isPrimary = existingAdjusterIds.length === 0;
      const { error: linkErr } = await supabase.from("job_adjusters").insert({
        job_id: jobId,
        contact_id: contact.id,
        is_primary: isPrimary,
      });
      if (linkErr) throw linkErr;

      toast.success("Adjuster created and added");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to create adjuster");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Adjuster</DialogTitle>
        </DialogHeader>

        {/* Mode tabs */}
        <div className="flex gap-2 mb-4">
          <Button
            variant={mode === "search" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("search")}
          >
            Search Existing
          </Button>
          <Button
            variant={mode === "create" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("create")}
          >
            Create New
          </Button>
        </div>

        {mode === "search" ? (
          <div className="space-y-3">
            <Input
              placeholder="Search by name or company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searching && <p className="text-xs text-muted-foreground">Searching...</p>}
            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left rounded-lg border border-border bg-background/50 p-3 hover:bg-accent transition-colors"
                    onClick={() => handleLinkExisting(c.id)}
                    disabled={saving}
                  >
                    <p className="text-sm font-medium text-foreground">
                      {c.first_name} {c.last_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[c.title, c.company].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[c.phone, c.email].filter(Boolean).join(" · ")}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                No matching adjusters found.{" "}
                <button className="text-primary underline" onClick={() => setMode("create")}>
                  Create a new one
                </button>
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">First Name *</label>
                <Input value={form.first_name} onChange={(e) => update("first_name", e.target.value)} autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Last Name *</label>
                <Input value={form.last_name} onChange={(e) => update("last_name", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Title</label>
                <Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Field Adjuster" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Company</label>
                <Input value={form.company} onChange={(e) => update("company", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Phone</label>
                <Input type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Email</label>
                <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleCreateNew} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create & Add
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Import Contact type**

Ensure `Contact` is imported in the types import at line 4. Add it if not already present:

```typescript
import type { Job, JobActivity, Payment, Photo, PhotoTag, PhotoReport, Email, JobAdjuster, Contact } from "@/lib/types";
```

- [ ] **Step 3: Render the AddAdjusterDialog in the main component**

Near the other dialog renders, add:

```tsx
      <AddAdjusterDialog
        open={addAdjusterOpen}
        onOpenChange={setAddAdjusterOpen}
        jobId={jobId}
        existingAdjusterIds={(job.job_adjusters || []).map((ja) => ja.contact_id)}
        onSaved={fetchData}
      />
```

- [ ] **Step 4: Run tsc to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: All dialog errors gone. Remaining errors should only be in `intake-form.tsx` (Task 9).

- [ ] **Step 5: Commit**

```bash
git add src/components/job-detail.tsx
git commit -m "feat: add AddAdjusterDialog with search existing + create new modes"
```

---

### Task 8: Clean Up EditJobInfoDialog

**Files:**
- Modify: `src/components/job-detail.tsx:893-1042` (EditJobInfoDialog)

Remove the insurance_company and claim_number fields from the EditJobInfoDialog since they now live in EditInsuranceDialog.

- [ ] **Step 1: Remove insurance fields from form state**

In the EditJobInfoDialog form state (around line 907-917), remove `insurance_company` and `claim_number`:

Old:
```typescript
  const [form, setForm] = useState({
    property_address: "",
    property_type: "" as string,
    property_sqft: "" as string,
    property_stories: "" as string,
    damage_source: "",
    affected_areas: "",
    access_notes: "",
    insurance_company: "",
    claim_number: "",
  });
```

New:
```typescript
  const [form, setForm] = useState({
    property_address: "",
    property_type: "" as string,
    property_sqft: "" as string,
    property_stories: "" as string,
    damage_source: "",
    affected_areas: "",
    access_notes: "",
  });
```

- [ ] **Step 2: Remove insurance fields from useEffect initializer**

In the useEffect that populates the form (search for `setForm({` inside EditJobInfoDialog), remove the `insurance_company` and `claim_number` lines.

- [ ] **Step 3: Remove insurance fields from the update payload**

In the `handleSave` function, remove `insurance_company` and `claim_number` from the Supabase `.update({...})` call.

- [ ] **Step 4: Remove the insurance form section from JSX**

Remove the entire insurance section block (the `<div className="border-t border-border/50 pt-4">` containing the "Insurance" heading, insurance_company input, and claim_number input — around lines 1020-1031).

- [ ] **Step 5: Run tsc to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No new errors from this change.

- [ ] **Step 6: Commit**

```bash
git add src/components/job-detail.tsx
git commit -m "refactor: remove insurance fields from EditJobInfoDialog

Insurance company and claim number are now edited in the new EditInsuranceDialog."
```

---

### Task 9: Update Intake Form

**Files:**
- Modify: `src/components/intake-form.tsx:99-137`

Update the intake form to create `job_adjusters` rows instead of setting `adjuster_contact_id` on the job.

- [ ] **Step 1: Update adjuster handling in the submit function**

In `src/components/intake-form.tsx`, the adjuster creation is at lines 99-116 and the job insertion is at lines 119-137.

First, change the job insert to remove `adjuster_contact_id`. Find line 133:
```typescript
    adjuster_contact_id: adjusterContactId,
```
Remove this line entirely.

- [ ] **Step 2: Add job_adjusters insert after job creation**

After the job creation block (after `if (jobErr) throw jobErr;` around line 137), add:

```typescript
    // 3b. Link adjuster to job via job_adjusters if one was created
    if (adjusterContactId && job) {
      const { error: adjLinkErr } = await supabase
        .from("job_adjusters")
        .insert({
          job_id: job.id,
          contact_id: adjusterContactId,
          is_primary: true,
        });
      if (adjLinkErr) throw adjLinkErr;
    }
```

- [ ] **Step 3: Run tsc to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors referencing `adjuster_contact_id`. Check for any remaining type errors across the project.

- [ ] **Step 4: Commit**

```bash
git add src/components/intake-form.tsx
git commit -m "feat: update intake form to use job_adjusters junction table

Create job_adjusters row instead of setting adjuster_contact_id on job."
```

---

### Task 10: Final Verification & Cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full tsc check**

Run: `npx tsc --noEmit 2>&1`

Expected: Only the pre-existing 39 errors in jarvis/neural-network (per project memory). No new errors. If there are new errors, fix them.

- [ ] **Step 2: Check for any remaining references to adjuster_contact_id**

Search the codebase:
```bash
grep -r "adjuster_contact_id" src/ --include="*.ts" --include="*.tsx"
```

Expected: No results. If any remain, update them.

- [ ] **Step 3: Check for any remaining references to `job.adjuster` (old joined field)**

Search:
```bash
grep -r "job\.adjuster[^s]" src/ --include="*.ts" --include="*.tsx"
```

Expected: No results (all replaced by `job.job_adjusters`).

- [ ] **Step 4: Start the dev server and manually verify**

Run: `npm run dev`

Open the app, navigate to a job detail page, and verify:
- Single card with 3 columns and vertical dividers
- Job Info column displays correctly
- Contact column shows condensed homeowner card with role badge
- Adjusters section shows existing adjusters (if any) with primary badge
- Insurance column shows condensed insurance card
- HOA section displays (or shows "No HOA info")
- Edit pencil on Insurance opens EditInsuranceDialog with all fields
- Add adjuster button opens AddAdjusterDialog with search/create modes
- Adjuster card hover shows ••• menu with Set as Primary / Remove options

- [ ] **Step 5: Run security advisors check**

Use the Supabase MCP `get_advisors` tool with type "security" to verify the new `job_adjusters` table has proper RLS.

- [ ] **Step 6: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final cleanup for insurance redesign"
```
