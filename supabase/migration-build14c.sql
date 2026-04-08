-- ============================================
-- Build 14c Migration: Dynamic Job Statuses + Damage Types
-- Run this in the Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. JOB STATUSES TABLE
-- ============================================
CREATE TABLE job_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  display_label text NOT NULL,
  bg_color text NOT NULL DEFAULT '#F1EFE8',
  text_color text NOT NULL DEFAULT '#5F5E5A',
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 2. DAMAGE TYPES TABLE
-- ============================================
CREATE TABLE damage_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  display_label text NOT NULL,
  bg_color text NOT NULL DEFAULT '#F1EFE8',
  text_color text NOT NULL DEFAULT '#5F5E5A',
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 3. SEED DEFAULT STATUSES
-- ============================================
INSERT INTO job_statuses (name, display_label, bg_color, text_color, sort_order, is_default) VALUES
  ('new',              'New',              '#FAEEDA', '#633806', 1, true),
  ('in_progress',      'In Progress',      '#E1F5EE', '#085041', 2, true),
  ('pending_invoice',  'Pending Invoice',  '#EEEDFE', '#3C3489', 3, true),
  ('completed',        'Completed',        '#F1EFE8', '#5F5E5A', 4, true),
  ('cancelled',        'Cancelled',        '#F1EFE8', '#5F5E5A', 5, true);

-- ============================================
-- 4. SEED DEFAULT DAMAGE TYPES
-- ============================================
INSERT INTO damage_types (name, display_label, bg_color, text_color, icon, sort_order, is_default) VALUES
  ('water',     'Water',     '#E6F1FB', '#0C447C', 'Droplets',    1, true),
  ('fire',      'Fire',      '#FAECE7', '#712B13', 'Flame',       2, true),
  ('mold',      'Mold',      '#EAF3DE', '#27500A', 'Bug',         3, true),
  ('storm',     'Storm',     '#EEEDFE', '#3C3489', 'CloudRain',   4, true),
  ('biohazard', 'Biohazard', '#FCEBEB', '#791F1F', 'Biohazard',   5, true),
  ('contents',  'Contents',  '#FFF8E6', '#7A5E00', 'Package',     6, true),
  ('rebuild',   'Rebuild',   '#F1EFE8', '#5F5E5A', 'Hammer',      7, true),
  ('other',     'Other',     '#F1EFE8', '#5F5E5A', NULL,          8, true);

-- ============================================
-- 5. DROP CHECK CONSTRAINTS ON JOBS TABLE
-- ============================================
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_damage_type_check;

-- ============================================
-- 6. AUTO-UPDATE TIMESTAMPS
-- ============================================
CREATE TRIGGER trg_job_statuses_updated_at
  BEFORE UPDATE ON job_statuses FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_damage_types_updated_at
  BEFORE UPDATE ON damage_types FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 7. ROW LEVEL SECURITY
-- ============================================
ALTER TABLE job_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE damage_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on job_statuses" ON job_statuses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on damage_types" ON damage_types FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 8. INDEXES
-- ============================================
CREATE INDEX idx_job_statuses_sort_order ON job_statuses(sort_order);
CREATE INDEX idx_damage_types_sort_order ON damage_types(sort_order);
