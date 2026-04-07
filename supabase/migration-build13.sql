-- ============================================
-- Build 13 Migration: Compose, Reply, Forward + Attachments
-- Run this in the Supabase SQL Editor
-- ============================================

-- 1. Add signature column to email_accounts
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS signature text;

-- 2. Add unique constraint for dedup (message_id + account_id + folder)
CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_dedup
  ON emails(message_id, account_id, folder);
