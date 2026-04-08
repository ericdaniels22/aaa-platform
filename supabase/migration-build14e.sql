-- ============================================
-- Build 14e Migration: Email Signatures
-- Run this in the Supabase SQL Editor
-- ============================================

CREATE TABLE email_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  signature_html text NOT NULL DEFAULT '',
  include_logo boolean NOT NULL DEFAULT true,
  auto_insert boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id)
);

CREATE TRIGGER trg_email_signatures_updated_at
  BEFORE UPDATE ON email_signatures FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE email_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on email_signatures"
  ON email_signatures FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_email_signatures_account_id ON email_signatures(account_id);
