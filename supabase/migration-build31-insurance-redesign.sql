-- Build 31: Insurance & Contact Redesign
-- Adds insurance detail columns (policy_number, date_of_loss, deductible),
-- HOA fields, job_adjusters junction table, contacts.title column.
-- Migrates existing adjuster_contact_id data and drops the old column.

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
