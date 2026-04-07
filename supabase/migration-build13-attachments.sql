-- Build 13 Module 4: Email Attachments Storage
-- Run this in Supabase SQL Editor

-- 1. Create storage bucket for email attachments (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-attachments', 'email-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Storage policy: allow all operations via service role (API routes use service key)
CREATE POLICY "Allow service role on email-attachments"
  ON storage.objects FOR ALL
  USING (bucket_id = 'email-attachments')
  WITH CHECK (bucket_id = 'email-attachments');
