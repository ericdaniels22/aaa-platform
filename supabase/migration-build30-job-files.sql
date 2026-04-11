-- Build 30: job_files table + job-files storage bucket
--
-- Adds a "Files" section to the job detail page. Sibling of the Photos
-- section — this holds arbitrary documents (contracts, estimates,
-- invoices, PDFs, spreadsheets, etc.) that aren't photos.
--
-- All I/O goes through the /api/jobs/[id]/files/* API routes; the
-- bucket policy matches email-attachments (permissive; API routes are
-- the only caller).

-- 1. Table
CREATE TABLE job_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  storage_path  text NOT NULL UNIQUE,
  size_bytes    bigint NOT NULL,
  mime_type     text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_files_job_id_created_at
  ON job_files (job_id, created_at DESC);

-- 2. Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-files', 'job-files', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Bucket policy (matches email-attachments — API routes are the only caller)
CREATE POLICY "Allow all on job-files"
  ON storage.objects FOR ALL
  USING (bucket_id = 'job-files')
  WITH CHECK (bucket_id = 'job-files');
