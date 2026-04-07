-- ============================================
-- Build 12 Migration: Full Email Inbox
-- Run this in the Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. DROP OLD job_emails TABLE
-- ============================================
DROP TABLE IF EXISTS job_emails;

-- ============================================
-- 2. ADD COLUMNS TO email_accounts
-- ============================================
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT 'AAA Disaster Recovery',
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'hostinger',
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- ============================================
-- 3. CREATE NEW emails TABLE
-- ============================================
CREATE TABLE emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  message_id text NOT NULL,
  thread_id text,
  folder text NOT NULL DEFAULT 'inbox'
    CHECK (folder IN ('inbox', 'sent', 'drafts', 'trash', 'archive', 'spam', 'other')),
  from_address text NOT NULL,
  from_name text,
  to_addresses jsonb NOT NULL DEFAULT '[]',
  cc_addresses jsonb NOT NULL DEFAULT '[]',
  bcc_addresses jsonb NOT NULL DEFAULT '[]',
  subject text NOT NULL DEFAULT '',
  body_text text,
  body_html text,
  snippet text,
  is_read boolean NOT NULL DEFAULT false,
  is_starred boolean NOT NULL DEFAULT false,
  has_attachments boolean NOT NULL DEFAULT false,
  matched_by text
    CHECK (matched_by IN ('contact', 'claim_number', 'address', 'job_id', 'manual')),
  uid integer,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 4. CREATE email_attachments TABLE
-- ============================================
CREATE TABLE email_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text,
  file_size integer,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 5. ROW LEVEL SECURITY
-- ============================================
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on emails" ON emails FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on email_attachments" ON email_attachments FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 6. INDEXES
-- ============================================
CREATE INDEX idx_emails_account_id ON emails(account_id);
CREATE INDEX idx_emails_job_id ON emails(job_id);
CREATE INDEX idx_emails_folder ON emails(folder);
CREATE INDEX idx_emails_message_id ON emails(message_id);
CREATE INDEX idx_emails_thread_id ON emails(thread_id);
CREATE INDEX idx_emails_received_at ON emails(received_at DESC);
CREATE INDEX idx_emails_is_read ON emails(is_read) WHERE is_read = false;
CREATE INDEX idx_emails_is_starred ON emails(is_starred) WHERE is_starred = true;
CREATE INDEX idx_email_attachments_email_id ON email_attachments(email_id);

-- ============================================
-- 7. STORAGE BUCKET FOR EMAIL ATTACHMENTS
-- ============================================
-- Run separately if needed:
--   INSERT INTO storage.buckets (id, name, public) VALUES ('email-attachments', 'email-attachments', false);
--   CREATE POLICY "Allow all on email-attachments bucket" ON storage.objects FOR ALL USING (bucket_id = 'email-attachments') WITH CHECK (bucket_id = 'email-attachments');
