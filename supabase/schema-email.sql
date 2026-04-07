-- ============================================
-- AAA Disaster Recovery — Email System Schema
-- Run this in the Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. EMAIL ACCOUNTS
-- Stores IMAP/SMTP connection settings
-- ============================================
CREATE TABLE email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  email_address text NOT NULL,
  imap_host text NOT NULL DEFAULT 'imap.hostinger.com',
  imap_port integer NOT NULL DEFAULT 993,
  smtp_host text NOT NULL DEFAULT 'smtp.hostinger.com',
  smtp_port integer NOT NULL DEFAULT 465,
  username text NOT NULL,
  encrypted_password text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  last_synced_uid integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 2. JOB EMAILS
-- Stores synced emails matched to jobs
-- ============================================
CREATE TABLE job_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  email_account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  thread_id text,
  from_address text NOT NULL,
  from_name text,
  to_address text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body_text text,
  body_html text,
  snippet text,
  direction text NOT NULL DEFAULT 'inbound'
    CHECK (direction IN ('inbound', 'outbound')),
  has_attachments boolean NOT NULL DEFAULT false,
  matched_by text NOT NULL DEFAULT 'manual'
    CHECK (matched_by IN ('contact', 'claim_number', 'address', 'job_id', 'manual')),
  uid integer,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- AUTO-UPDATE updated_at TIMESTAMPS
-- ============================================
CREATE TRIGGER trg_email_accounts_updated_at
  BEFORE UPDATE ON email_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY (open for now)
-- ============================================
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on email_accounts" ON email_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on job_emails" ON job_emails FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_job_emails_job_id ON job_emails(job_id);
CREATE INDEX idx_job_emails_email_account_id ON job_emails(email_account_id);
CREATE INDEX idx_job_emails_message_id ON job_emails(message_id);
CREATE INDEX idx_job_emails_received_at ON job_emails(received_at DESC);
CREATE INDEX idx_job_emails_direction ON job_emails(direction);
