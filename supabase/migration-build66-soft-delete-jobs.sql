-- Build 66: Soft-delete + 30-day trash for jobs.
--
-- Adds a `deleted_at` timestamp to jobs. NULL = active job; non-NULL = in
-- trash since that timestamp. Application code filters on this column;
-- nothing is enforced via RLS so the trash UI can list deleted jobs with
-- the user's normal session.
--
-- Lazy purge (>30 days) and the actual hard-delete are handled in the
-- API layer (src/app/api/jobs/trash/route.ts and the DELETE handler at
-- src/app/api/jobs/[id]/route.ts), since they need to delete storage
-- objects in addition to cascading SQL rows.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Composite index supports both halves of the filter the UI uses:
--   WHERE organization_id = $1 AND deleted_at IS NULL  -- active list
--   WHERE organization_id = $1 AND deleted_at IS NOT NULL -- trash list
CREATE INDEX IF NOT EXISTS idx_jobs_org_deleted_at
  ON jobs (organization_id, deleted_at);
