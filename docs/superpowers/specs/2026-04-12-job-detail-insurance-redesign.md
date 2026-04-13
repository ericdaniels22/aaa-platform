# Job Detail — Insurance & Contact Redesign

## Summary

Redesign the job detail header from two cards (Job Info + Contact & Insurance) into a **single unified card with three columns** separated by faint vertical dividers:

1. **Job Info** — property and damage details (existing, unchanged)
2. **Contact** — homeowner/tenant card + multiple adjusters with primary designation
3. **Insurance** — policy details card + HOA information card

## Layout

Single card, three-column grid with `1px #2a3040` vertical dividers between columns. Each column has its own header with edit pencil icon. Columns align to top.

### Column 1: Job Info
Unchanged from today. Displays:
- Address
- Property Type
- Damage Source
- Affected Areas
- Intake Date

Edit pencil opens existing `EditJobInfoDialog`.

### Column 2: Contact
- **Homeowner card** — condensed card showing name, phone, email. Blue "HOMEOWNER" badge (or "TENANT", "PROPERTY MANAGER" based on role). Edit pencil on column header edits this contact.
- **Adjusters sub-section** — "ADJUSTERS" label with green `+` button. Lists adjuster contact cards:
  - Each card shows: name, title/role, company, phone, email
  - Primary adjuster gets a green "PRIMARY" badge
  - Clicking `+` opens a dialog to search existing contacts or create a new adjuster
  - Each adjuster card has options to edit, remove, or set as primary

### Column 3: Insurance
- **Insurance card** — condensed card showing company name (headline), claim #, policy #, date of loss, deductible. Edit pencil on column header opens insurance edit dialog.
- **HOA sub-section** — "HOA" label. Single condensed card showing HOA name, contact person name, phone, email.

## Data Model Changes

### New columns on `jobs` table
| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `policy_number` | text | YES | Insurance policy number |
| `date_of_loss` | date | YES | Date the loss occurred |
| `deductible` | numeric(10,2) | YES | Deductible amount in dollars |
| `hoa_name` | text | YES | HOA company/association name |
| `hoa_contact_name` | text | YES | HOA contact person |
| `hoa_contact_phone` | text | YES | HOA contact phone |
| `hoa_contact_email` | text | YES | HOA contact email |

### New junction table: `job_adjusters`
Replaces the single `adjuster_contact_id` FK on `jobs`. Supports multiple adjusters per job with a primary designation.

```sql
CREATE TABLE job_adjusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, contact_id)
);
```

**Constraint:** Only one adjuster per job can have `is_primary = true`. Enforced at application level (set all others to false when toggling primary).

### Contact table changes
Add `title` column to contacts for adjuster title/role (e.g., "Field Adjuster", "Desk Adjuster"):

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `title` | text | YES | Job title (e.g., "Field Adjuster") |

### Migration of existing data
- Existing `adjuster_contact_id` values migrate into `job_adjusters` rows with `is_primary = true`
- Column `adjuster_contact_id` is dropped after migration
- Migration file: `supabase/migration-build30-insurance-redesign.sql` (next sequential number)

## Edit Dialogs

### EditInsuranceDialog (new)
Triggered by pencil icon on Insurance column header. Fields:
- Insurance Company (text)
- Claim # (text)
- Policy # (text)
- Date of Loss (date picker)
- Deductible (currency input)
- HOA Name (text)
- HOA Contact Name (text)
- HOA Contact Phone (phone)
- HOA Contact Email (email)

All fields update the `jobs` table directly.

### AddAdjusterDialog (new)
Triggered by `+` button in Adjusters sub-section. Two modes:
1. **Search existing contacts** — type-ahead search of contacts table filtered to role = 'adjuster'. Selecting one creates a `job_adjusters` row.
2. **Create new adjuster** — form with: first name, last name, title, company, phone, email. Creates a contact with `role = 'adjuster'`, then links via `job_adjusters`.

If this is the first adjuster on the job, auto-set `is_primary = true`.

### Adjuster card actions
Each adjuster card has a small context menu (three-dot or on-hover) with:
- **Set as Primary** — toggles `is_primary`, clears previous primary
- **Edit** — opens contact edit dialog for that adjuster
- **Remove** — removes the `job_adjusters` row (does NOT delete the contact)

### EditContactDialog (existing, unchanged)
Continues to edit the homeowner/tenant contact. No changes needed.

### EditJobInfoDialog (existing, modified)
Remove `insurance_company` and `claim_number` fields from this dialog — they move to the new `EditInsuranceDialog`.

## Query Changes

Update the `fetchData` query in `job-detail.tsx`:

```
.from("jobs")
.select("*, contact:contacts!contact_id(*), job_adjusters(*, adjuster:contacts!contact_id(*))")
```

Drop the `adjuster:contacts!adjuster_contact_id(*)` join. Load adjusters through the junction table instead.

## Type Changes

Update `Job` interface in `types.ts`:
- Add: `policy_number`, `date_of_loss`, `deductible`, `hoa_name`, `hoa_contact_name`, `hoa_contact_phone`, `hoa_contact_email`
- Remove: `adjuster_contact_id`, `adjuster`
- Add: `job_adjusters?: JobAdjuster[]`

New interface:
```typescript
interface JobAdjuster {
  id: string;
  job_id: string;
  contact_id: string;
  is_primary: boolean;
  created_at: string;
  adjuster?: Contact;
}
```

Add `title` to `Contact` interface.

## Files Affected

- `src/components/job-detail.tsx` — layout restructure, new dialogs, query changes
- `src/lib/types.ts` — new interfaces and updated types
- `supabase/migration-build31-insurance-redesign.sql` — schema changes + data migration
- `src/components/intake-form.tsx` — update to use `job_adjusters` instead of `adjuster_contact_id`

## Out of Scope
- Intake form redesign for the new insurance/HOA fields (can be added later)
- Insurance company auto-complete / directory
- Multiple insurance policies per job
