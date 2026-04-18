-- ============================================
-- Build 33 Migration: Contracts (Build 15b - Remote Signing)
-- Adds the signing pipeline on top of the Build 15a template system:
--   contracts, contract_signers, contract_events, contract_email_settings
-- Plus job-level contract flags, a private storage bucket for signed PDFs
-- and signature PNGs, RPC functions for atomic state transitions, and
-- a seed row for the email settings.
-- Run this in the Supabase SQL Editor.
-- ============================================

-- ============================================
-- 1. CONTRACTS
-- ============================================
CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES contract_templates(id),
  template_version integer NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'viewed', 'signed', 'voided', 'expired')),
  filled_content_html text NOT NULL,
  filled_content_hash text NOT NULL,
  signed_pdf_path text,
  link_token text UNIQUE,
  link_expires_at timestamptz,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  signed_at timestamptz,
  voided_at timestamptz,
  voided_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  void_reason text,
  reminder_count integer NOT NULL DEFAULT 0,
  next_reminder_at timestamptz,
  sent_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contracts_job_id ON contracts(job_id);
CREATE INDEX idx_contracts_status ON contracts(status);
CREATE INDEX idx_contracts_link_expires_at ON contracts(link_expires_at);

CREATE TRIGGER trg_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 2. CONTRACT SIGNERS
-- ============================================
CREATE TABLE contract_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  signer_order integer NOT NULL CHECK (signer_order IN (1, 2)),
  role_label text,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  signature_image_path text,
  typed_name text,
  ip_address text,
  user_agent text,
  esign_consent_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, signer_order)
);

CREATE INDEX idx_contract_signers_contract_id ON contract_signers(contract_id);

-- ============================================
-- 3. CONTRACT EVENTS (audit trail)
-- ============================================
CREATE TABLE contract_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  signer_id uuid REFERENCES contract_signers(id) ON DELETE SET NULL,
  event_type text NOT NULL
    CHECK (event_type IN (
      'created', 'sent', 'email_delivered', 'email_opened',
      'link_viewed', 'signed', 'reminder_sent', 'voided', 'expired'
    )),
  ip_address text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contract_events_contract_created
  ON contract_events(contract_id, created_at DESC);

-- ============================================
-- 4. CONTRACT EMAIL SETTINGS (singleton row)
-- ============================================
CREATE TABLE contract_email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_from_email text NOT NULL DEFAULT '',
  send_from_name text NOT NULL DEFAULT '',
  reply_to_email text,
  provider text NOT NULL DEFAULT 'resend'
    CHECK (provider IN ('resend', 'email_account')),
  email_account_id uuid REFERENCES email_accounts(id) ON DELETE SET NULL,
  signing_request_subject_template text NOT NULL DEFAULT '',
  signing_request_body_template text NOT NULL DEFAULT '',
  signed_confirmation_subject_template text NOT NULL DEFAULT '',
  signed_confirmation_body_template text NOT NULL DEFAULT '',
  signed_confirmation_internal_subject_template text NOT NULL DEFAULT '',
  signed_confirmation_internal_body_template text NOT NULL DEFAULT '',
  reminder_subject_template text NOT NULL DEFAULT '',
  reminder_body_template text NOT NULL DEFAULT '',
  reminder_day_offsets jsonb NOT NULL DEFAULT '[1, 3]'::jsonb,
  default_link_expiry_days integer NOT NULL DEFAULT 7
    CHECK (default_link_expiry_days BETWEEN 1 AND 30),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_contract_email_settings_updated_at
  BEFORE UPDATE ON contract_email_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 5. JOBS: contract status flags
-- ============================================
ALTER TABLE jobs
  ADD COLUMN has_signed_contract boolean NOT NULL DEFAULT false,
  ADD COLUMN has_pending_contract boolean NOT NULL DEFAULT false;

-- ============================================
-- 6. ROW LEVEL SECURITY
-- Matching the platform-wide pattern: open to authenticated users.
-- Public signing-page access is server-only (service role) and never
-- hits RLS directly — tokens are validated in Node before queries run.
-- ============================================
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users"
  ON contracts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users"
  ON contract_signers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users"
  ON contract_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users"
  ON contract_email_settings FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 7. STORAGE BUCKET
-- Private bucket for signed PDFs and captured signature PNGs.
-- Access is always via server APIs using the service-role key.
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('contracts', 'contracts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "contracts_bucket_authenticated_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'contracts');

CREATE POLICY "contracts_bucket_authenticated_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'contracts');

CREATE POLICY "contracts_bucket_authenticated_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'contracts')
  WITH CHECK (bucket_id = 'contracts');

-- ============================================
-- 8. RPC FUNCTIONS — atomic state transitions
-- Called from API routes via supabase.rpc(...). Each function wraps the
-- set of writes for a single transition so partial failures can't leave
-- inconsistent state (per build spec). Email dispatch is intentionally
-- kept outside the txn — if the email fails after mark_contract_sent,
-- we don't roll back the DB; the user can manually resend.
-- ============================================

-- Creates a contract in 'draft' state plus its first signer and a
-- 'created' audit event. Caller pre-computes contract_id, signer_id, and
-- link_token so the JWT matches the row that gets inserted.
CREATE OR REPLACE FUNCTION create_contract_draft(
  p_contract_id uuid,
  p_signer_id uuid,
  p_job_id uuid,
  p_template_id uuid,
  p_template_version integer,
  p_title text,
  p_filled_content_html text,
  p_filled_content_hash text,
  p_link_token text,
  p_link_expires_at timestamptz,
  p_signer_order integer,
  p_signer_role_label text,
  p_signer_name text,
  p_signer_email text,
  p_sent_by uuid
) RETURNS uuid AS $$
BEGIN
  INSERT INTO contracts (
    id, job_id, template_id, template_version, title, status,
    filled_content_html, filled_content_hash,
    link_token, link_expires_at, sent_by
  ) VALUES (
    p_contract_id, p_job_id, p_template_id, p_template_version, p_title, 'draft',
    p_filled_content_html, p_filled_content_hash,
    p_link_token, p_link_expires_at, p_sent_by
  );

  INSERT INTO contract_signers (
    id, contract_id, signer_order, role_label, name, email
  ) VALUES (
    p_signer_id, p_contract_id, p_signer_order, p_signer_role_label,
    p_signer_name, p_signer_email
  );

  INSERT INTO contract_events (contract_id, signer_id, event_type)
  VALUES (p_contract_id, p_signer_id, 'created');

  RETURN p_contract_id;
END;
$$ LANGUAGE plpgsql;

-- Promotes a draft contract to 'sent' after the signing-request email
-- has been accepted by the provider. Updates the job's pending flag and
-- logs the 'sent' event with provider metadata.
CREATE OR REPLACE FUNCTION mark_contract_sent(
  p_contract_id uuid,
  p_message_id text,
  p_provider text
) RETURNS void AS $$
DECLARE
  v_job_id uuid;
BEGIN
  UPDATE contracts
    SET status = 'sent', sent_at = now()
    WHERE id = p_contract_id AND status = 'draft'
    RETURNING job_id INTO v_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract % is not in draft state', p_contract_id;
  END IF;

  INSERT INTO contract_events (contract_id, event_type, metadata)
  VALUES (
    p_contract_id, 'sent',
    jsonb_build_object('provider', p_provider, 'message_id', p_message_id)
  );

  UPDATE jobs
    SET has_pending_contract = true
    WHERE id = v_job_id;
END;
$$ LANGUAGE plpgsql;

-- Records a signer's signature atomically. Returns the owning contract_id
-- and whether all signers on the contract have now signed so the caller
-- knows whether to finalize.
CREATE OR REPLACE FUNCTION record_signer_signature(
  p_signer_id uuid,
  p_typed_name text,
  p_ip_address text,
  p_user_agent text,
  p_signature_image_path text
) RETURNS TABLE(contract_id uuid, all_signed boolean) AS $$
DECLARE
  v_contract_id uuid;
  v_unsigned_count integer;
BEGIN
  UPDATE contract_signers
    SET typed_name = p_typed_name,
        ip_address = p_ip_address,
        user_agent = p_user_agent,
        signature_image_path = p_signature_image_path,
        esign_consent_at = now(),
        signed_at = now()
    WHERE id = p_signer_id AND signed_at IS NULL
    RETURNING contract_signers.contract_id INTO v_contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signer % not found or already signed', p_signer_id;
  END IF;

  INSERT INTO contract_events (contract_id, signer_id, event_type, ip_address, user_agent)
  VALUES (v_contract_id, p_signer_id, 'signed', p_ip_address, p_user_agent);

  SELECT COUNT(*) INTO v_unsigned_count
    FROM contract_signers cs
    WHERE cs.contract_id = v_contract_id AND cs.signed_at IS NULL;

  contract_id := v_contract_id;
  all_signed := v_unsigned_count = 0;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Finalizes a fully-signed contract: status → 'signed', stores pdf path,
-- flips the job's contract flags. Called after PDF generation + upload.
CREATE OR REPLACE FUNCTION mark_contract_signed(
  p_contract_id uuid,
  p_pdf_path text
) RETURNS void AS $$
DECLARE
  v_job_id uuid;
BEGIN
  UPDATE contracts
    SET status = 'signed',
        signed_at = now(),
        signed_pdf_path = p_pdf_path
    WHERE id = p_contract_id AND status IN ('sent', 'viewed', 'draft')
    RETURNING job_id INTO v_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract % cannot be signed from its current status', p_contract_id;
  END IF;

  UPDATE jobs
    SET has_signed_contract = true,
        has_pending_contract = false
    WHERE id = v_job_id;
END;
$$ LANGUAGE plpgsql;

-- Voids a contract and recomputes the job's pending flag based on any
-- remaining non-voided sent/viewed contracts.
CREATE OR REPLACE FUNCTION void_contract(
  p_contract_id uuid,
  p_voided_by uuid,
  p_reason text
) RETURNS void AS $$
DECLARE
  v_job_id uuid;
BEGIN
  UPDATE contracts
    SET status = 'voided',
        voided_at = now(),
        voided_by = p_voided_by,
        void_reason = p_reason
    WHERE id = p_contract_id AND status <> 'voided'
    RETURNING job_id INTO v_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract % is already voided or not found', p_contract_id;
  END IF;

  INSERT INTO contract_events (contract_id, event_type, metadata)
  VALUES (p_contract_id, 'voided', jsonb_build_object('reason', p_reason));

  UPDATE jobs
    SET has_pending_contract = EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.job_id = v_job_id
        AND c.status IN ('sent', 'viewed')
    )
    WHERE id = v_job_id;
END;
$$ LANGUAGE plpgsql;

-- Reissues a signing link on an expired (or otherwise pending) contract:
-- fresh token, new expiration, back to 'sent' status. Clears first/last
-- view timestamps so the audit trail for the new attempt starts clean.
CREATE OR REPLACE FUNCTION resend_contract_link(
  p_contract_id uuid,
  p_link_token text,
  p_link_expires_at timestamptz
) RETURNS void AS $$
BEGIN
  UPDATE contracts
    SET link_token = p_link_token,
        link_expires_at = p_link_expires_at,
        status = 'sent',
        sent_at = now(),
        first_viewed_at = NULL,
        last_viewed_at = NULL
    WHERE id = p_contract_id AND status IN ('expired', 'sent', 'viewed');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract % cannot be resent from its current status', p_contract_id;
  END IF;

  INSERT INTO contract_events (contract_id, event_type)
  VALUES (p_contract_id, 'sent');

  UPDATE jobs
    SET has_pending_contract = true
    WHERE id = (SELECT job_id FROM contracts WHERE id = p_contract_id);
END;
$$ LANGUAGE plpgsql;

-- Marks a contract as expired and logs the event. Called lazily from the
-- public signing page when a customer hits a stale link.
CREATE OR REPLACE FUNCTION mark_contract_expired(
  p_contract_id uuid
) RETURNS void AS $$
BEGIN
  UPDATE contracts
    SET status = 'expired'
    WHERE id = p_contract_id AND status IN ('sent', 'viewed');

  IF FOUND THEN
    INSERT INTO contract_events (contract_id, event_type)
    VALUES (p_contract_id, 'expired');

    UPDATE jobs
      SET has_pending_contract = EXISTS (
        SELECT 1 FROM contracts c
        WHERE c.job_id = jobs.id
          AND c.status IN ('sent', 'viewed')
      )
      WHERE id = (SELECT job_id FROM contracts WHERE id = p_contract_id);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. SEED: contract_email_settings singleton
-- Send-from fields are intentionally blank. The /settings/contracts page
-- shows a setup banner until they're filled in; the send API hard-fails
-- if either is empty. This keeps company identity out of source code
-- (SaaS Readiness Principle 1 from v1.6).
-- ============================================
INSERT INTO contract_email_settings (
  send_from_email,
  send_from_name,
  provider,
  signing_request_subject_template,
  signing_request_body_template,
  signed_confirmation_subject_template,
  signed_confirmation_body_template,
  signed_confirmation_internal_subject_template,
  signed_confirmation_internal_body_template,
  reminder_subject_template,
  reminder_body_template,
  reminder_day_offsets,
  default_link_expiry_days
) VALUES (
  '',
  '',
  'resend',
  'Please sign: {{document_title}}',
  '<p>Hi {{customer_name}},</p><p>Please review and sign <strong>{{document_title}}</strong> at the link below. The link is valid for a limited time.</p><p><a href="{{signing_link}}">Open document</a></p><p>Thanks,<br>{{company_name}}</p>',
  'Signed: {{document_title}}',
  '<p>Hi {{customer_name}},</p><p>Thanks for signing <strong>{{document_title}}</strong>. A signed copy is attached for your records.</p><p>{{company_name}}<br>{{company_phone}}</p>',
  '[{{job_number}}] Contract signed: {{document_title}}',
  '<p>{{customer_name}} signed <strong>{{document_title}}</strong>.</p><p>A signed copy is attached.</p>',
  'Reminder: please sign {{document_title}}',
  '<p>Hi {{customer_name}},</p><p>Just a quick reminder to sign <strong>{{document_title}}</strong>.</p><p><a href="{{signing_link}}">Open document</a></p><p>Thanks,<br>{{company_name}}</p>',
  '[1, 3]'::jsonb,
  7
);
