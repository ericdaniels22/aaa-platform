-- build59: patch 7 contract-related RPC functions to include organization_id
-- when INSERTing into public.contract_events. contract_events.organization_id
-- is NOT NULL with no default since build45, so these INSERTs have been
-- failing with a 23502 NOT NULL violation every time the app invoked one of
-- the RPCs. The defect existed pre-18b — the SQL trigger audit in Session A
-- surfaced it. Same class of bug as build54 (QB triggers), different table.
--
-- Source of organization_id per function:
--   activate_next_signer      → SELECT organization_id FROM contracts WHERE id = p_contract_id
--   mark_contract_expired     → same
--   mark_contract_sent        → same
--   mark_reminder_sent        → same
--   resend_contract_link      → same
--   void_contract             → same
--   record_signer_signature   → two-step: contract_signers → contracts
--
-- Every function preserves its existing behavior otherwise. No new logic,
-- no optimizations, no parameter signature changes. The only additions are
--   (a) a DECLARE v_org uuid;
--   (b) a SELECT ... INTO v_org + IF NULL RAISE guard near the top
--   (c) organization_id, v_org in the contract_events INSERT column/value lists
--
-- Runs in Session C between build55 (hook function) and build56 (drop
-- redundant custom policies). Earliest safe point — build57 would otherwise
-- flip tenant_isolation enforcement on these INSERTs while they still lack
-- organization_id.

CREATE OR REPLACE FUNCTION public.activate_next_signer(p_contract_id uuid, p_next_signer_id uuid, p_link_token text, p_link_expires_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.contracts WHERE id = p_contract_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'activate_next_signer: contract % not found or missing organization_id', p_contract_id;
  END IF;

  UPDATE contracts
    SET link_token = p_link_token,
        link_expires_at = p_link_expires_at,
        first_viewed_at = NULL,
        last_viewed_at = NULL,
        reminder_count = 0,
        next_reminder_at = NULL
    WHERE id = p_contract_id AND status IN ('sent', 'viewed');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract % is not in sent/viewed state', p_contract_id;
  END IF;

  INSERT INTO contract_events (organization_id, contract_id, signer_id, event_type, metadata)
  VALUES (
    v_org, p_contract_id, p_next_signer_id, 'sent',
    jsonb_build_object('activated_next_signer', true)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_contract_expired(p_contract_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.contracts WHERE id = p_contract_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'mark_contract_expired: contract % not found or missing organization_id', p_contract_id;
  END IF;

  UPDATE contracts
    SET status = 'expired'
    WHERE id = p_contract_id AND status IN ('sent', 'viewed');

  IF FOUND THEN
    INSERT INTO contract_events (organization_id, contract_id, event_type)
    VALUES (v_org, p_contract_id, 'expired');

    UPDATE jobs
      SET has_pending_contract = EXISTS (
        SELECT 1 FROM contracts c
        WHERE c.job_id = jobs.id
          AND c.status IN ('sent', 'viewed')
      )
      WHERE id = (SELECT job_id FROM contracts WHERE id = p_contract_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_contract_sent(p_contract_id uuid, p_message_id text, p_provider text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_org uuid;
  v_job_id uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.contracts WHERE id = p_contract_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'mark_contract_sent: contract % not found or missing organization_id', p_contract_id;
  END IF;

  UPDATE contracts
    SET status = 'sent', sent_at = now()
    WHERE id = p_contract_id AND status = 'draft'
    RETURNING job_id INTO v_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract % is not in draft state', p_contract_id;
  END IF;

  INSERT INTO contract_events (organization_id, contract_id, event_type, metadata)
  VALUES (
    v_org, p_contract_id, 'sent',
    jsonb_build_object('provider', p_provider, 'message_id', p_message_id)
  );

  UPDATE jobs
    SET has_pending_contract = true
    WHERE id = v_job_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_reminder_sent(p_contract_id uuid, p_offsets jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_org uuid;
  v_sent_at timestamptz;
  v_new_count integer;
  v_next timestamptz;
  v_offset_count integer;
  v_next_offset integer;
BEGIN
  SELECT organization_id INTO v_org FROM public.contracts WHERE id = p_contract_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'mark_reminder_sent: contract % not found or missing organization_id', p_contract_id;
  END IF;

  UPDATE contracts
    SET reminder_count = reminder_count + 1
    WHERE id = p_contract_id
    RETURNING sent_at, reminder_count INTO v_sent_at, v_new_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract % not found for reminder update', p_contract_id;
  END IF;

  v_offset_count := jsonb_array_length(p_offsets);
  IF v_new_count < v_offset_count THEN
    v_next_offset := (p_offsets->>(v_new_count))::integer;
    IF v_sent_at IS NOT NULL THEN
      v_next := v_sent_at + (v_next_offset::text || ' days')::interval;
    ELSE
      v_next := NULL;
    END IF;
  ELSE
    v_next := NULL;
  END IF;

  UPDATE contracts SET next_reminder_at = v_next WHERE id = p_contract_id;

  INSERT INTO contract_events (organization_id, contract_id, event_type, metadata)
  VALUES (
    v_org, p_contract_id, 'reminder_sent',
    jsonb_build_object('reminder_count', v_new_count)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_signer_signature(p_signer_id uuid, p_typed_name text, p_ip_address text, p_user_agent text, p_signature_image_path text)
 RETURNS TABLE(contract_id uuid, all_signed boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_contract_id uuid;
  v_org uuid;
  v_unsigned_count integer;
BEGIN
  SELECT cs.contract_id INTO v_contract_id FROM public.contract_signers cs WHERE cs.id = p_signer_id;
  IF v_contract_id IS NULL THEN
    RAISE EXCEPTION 'record_signer_signature: signer % not found', p_signer_id;
  END IF;

  SELECT organization_id INTO v_org FROM public.contracts WHERE id = v_contract_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'record_signer_signature: contract % not found or missing organization_id', v_contract_id;
  END IF;

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

  INSERT INTO contract_events (organization_id, contract_id, signer_id, event_type, ip_address, user_agent)
  VALUES (v_org, v_contract_id, p_signer_id, 'signed', p_ip_address, p_user_agent);

  SELECT COUNT(*) INTO v_unsigned_count
    FROM contract_signers cs
    WHERE cs.contract_id = v_contract_id AND cs.signed_at IS NULL;

  contract_id := v_contract_id;
  all_signed := v_unsigned_count = 0;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resend_contract_link(p_contract_id uuid, p_link_token text, p_link_expires_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.contracts WHERE id = p_contract_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'resend_contract_link: contract % not found or missing organization_id', p_contract_id;
  END IF;

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

  INSERT INTO contract_events (organization_id, contract_id, event_type)
  VALUES (v_org, p_contract_id, 'sent');

  UPDATE jobs
    SET has_pending_contract = true
    WHERE id = (SELECT job_id FROM contracts WHERE id = p_contract_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.void_contract(p_contract_id uuid, p_voided_by uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_org uuid;
  v_job_id uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.contracts WHERE id = p_contract_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'void_contract: contract % not found or missing organization_id', p_contract_id;
  END IF;

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

  INSERT INTO contract_events (organization_id, contract_id, event_type, metadata)
  VALUES (v_org, p_contract_id, 'voided', jsonb_build_object('reason', p_reason));

  UPDATE jobs
    SET has_pending_contract = EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.job_id = v_job_id
        AND c.status IN ('sent', 'viewed')
    )
    WHERE id = v_job_id;
END;
$function$;

-- ROLLBACK ---
-- Restores each function to its pre-build59 body (exactly as captured from
-- prod pg_proc on 2026-04-23 Session A prep). Note these pre-build59 bodies
-- have the NOT NULL defect that this migration patches — applying the
-- rollback restores the broken behavior.
--
-- CREATE OR REPLACE FUNCTION public.activate_next_signer(p_contract_id uuid, p_next_signer_id uuid, p_link_token text, p_link_expires_at timestamp with time zone)
--  RETURNS void LANGUAGE plpgsql AS $function$
-- BEGIN
--   UPDATE contracts
--     SET link_token = p_link_token, link_expires_at = p_link_expires_at,
--         first_viewed_at = NULL, last_viewed_at = NULL,
--         reminder_count = 0, next_reminder_at = NULL
--     WHERE id = p_contract_id AND status IN ('sent', 'viewed');
--   IF NOT FOUND THEN RAISE EXCEPTION 'Contract % is not in sent/viewed state', p_contract_id; END IF;
--   INSERT INTO contract_events (contract_id, signer_id, event_type, metadata)
--   VALUES (p_contract_id, p_next_signer_id, 'sent', jsonb_build_object('activated_next_signer', true));
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.mark_contract_expired(p_contract_id uuid)
--  RETURNS void LANGUAGE plpgsql AS $function$
-- BEGIN
--   UPDATE contracts SET status = 'expired'
--     WHERE id = p_contract_id AND status IN ('sent', 'viewed');
--   IF FOUND THEN
--     INSERT INTO contract_events (contract_id, event_type) VALUES (p_contract_id, 'expired');
--     UPDATE jobs SET has_pending_contract = EXISTS (
--         SELECT 1 FROM contracts c WHERE c.job_id = jobs.id AND c.status IN ('sent', 'viewed')
--       ) WHERE id = (SELECT job_id FROM contracts WHERE id = p_contract_id);
--   END IF;
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.mark_contract_sent(p_contract_id uuid, p_message_id text, p_provider text)
--  RETURNS void LANGUAGE plpgsql AS $function$
-- DECLARE v_job_id uuid;
-- BEGIN
--   UPDATE contracts SET status = 'sent', sent_at = now()
--     WHERE id = p_contract_id AND status = 'draft'
--     RETURNING job_id INTO v_job_id;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Contract % is not in draft state', p_contract_id; END IF;
--   INSERT INTO contract_events (contract_id, event_type, metadata)
--   VALUES (p_contract_id, 'sent', jsonb_build_object('provider', p_provider, 'message_id', p_message_id));
--   UPDATE jobs SET has_pending_contract = true WHERE id = v_job_id;
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.mark_reminder_sent(p_contract_id uuid, p_offsets jsonb)
--  RETURNS void LANGUAGE plpgsql AS $function$
-- DECLARE
--   v_sent_at timestamptz; v_new_count integer; v_next timestamptz;
--   v_offset_count integer; v_next_offset integer;
-- BEGIN
--   UPDATE contracts SET reminder_count = reminder_count + 1
--     WHERE id = p_contract_id
--     RETURNING sent_at, reminder_count INTO v_sent_at, v_new_count;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Contract % not found for reminder update', p_contract_id; END IF;
--   v_offset_count := jsonb_array_length(p_offsets);
--   IF v_new_count < v_offset_count THEN
--     v_next_offset := (p_offsets->>(v_new_count))::integer;
--     IF v_sent_at IS NOT NULL THEN
--       v_next := v_sent_at + (v_next_offset::text || ' days')::interval;
--     ELSE v_next := NULL; END IF;
--   ELSE v_next := NULL; END IF;
--   UPDATE contracts SET next_reminder_at = v_next WHERE id = p_contract_id;
--   INSERT INTO contract_events (contract_id, event_type, metadata)
--   VALUES (p_contract_id, 'reminder_sent', jsonb_build_object('reminder_count', v_new_count));
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.record_signer_signature(p_signer_id uuid, p_typed_name text, p_ip_address text, p_user_agent text, p_signature_image_path text)
--  RETURNS TABLE(contract_id uuid, all_signed boolean) LANGUAGE plpgsql AS $function$
-- DECLARE v_contract_id uuid; v_unsigned_count integer;
-- BEGIN
--   UPDATE contract_signers
--     SET typed_name = p_typed_name, ip_address = p_ip_address, user_agent = p_user_agent,
--         signature_image_path = p_signature_image_path,
--         esign_consent_at = now(), signed_at = now()
--     WHERE id = p_signer_id AND signed_at IS NULL
--     RETURNING contract_signers.contract_id INTO v_contract_id;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Signer % not found or already signed', p_signer_id; END IF;
--   INSERT INTO contract_events (contract_id, signer_id, event_type, ip_address, user_agent)
--   VALUES (v_contract_id, p_signer_id, 'signed', p_ip_address, p_user_agent);
--   SELECT COUNT(*) INTO v_unsigned_count FROM contract_signers cs
--     WHERE cs.contract_id = v_contract_id AND cs.signed_at IS NULL;
--   contract_id := v_contract_id;
--   all_signed := v_unsigned_count = 0;
--   RETURN NEXT;
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.resend_contract_link(p_contract_id uuid, p_link_token text, p_link_expires_at timestamp with time zone)
--  RETURNS void LANGUAGE plpgsql AS $function$
-- BEGIN
--   UPDATE contracts
--     SET link_token = p_link_token, link_expires_at = p_link_expires_at,
--         status = 'sent', sent_at = now(),
--         first_viewed_at = NULL, last_viewed_at = NULL
--     WHERE id = p_contract_id AND status IN ('expired', 'sent', 'viewed');
--   IF NOT FOUND THEN RAISE EXCEPTION 'Contract % cannot be resent from its current status', p_contract_id; END IF;
--   INSERT INTO contract_events (contract_id, event_type) VALUES (p_contract_id, 'sent');
--   UPDATE jobs SET has_pending_contract = true
--     WHERE id = (SELECT job_id FROM contracts WHERE id = p_contract_id);
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.void_contract(p_contract_id uuid, p_voided_by uuid, p_reason text)
--  RETURNS void LANGUAGE plpgsql AS $function$
-- DECLARE v_job_id uuid;
-- BEGIN
--   UPDATE contracts
--     SET status = 'voided', voided_at = now(),
--         voided_by = p_voided_by, void_reason = p_reason
--     WHERE id = p_contract_id AND status <> 'voided'
--     RETURNING job_id INTO v_job_id;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Contract % is already voided or not found', p_contract_id; END IF;
--   INSERT INTO contract_events (contract_id, event_type, metadata)
--   VALUES (p_contract_id, 'voided', jsonb_build_object('reason', p_reason));
--   UPDATE jobs SET has_pending_contract = EXISTS (
--       SELECT 1 FROM contracts c WHERE c.job_id = v_job_id AND c.status IN ('sent', 'viewed')
--     ) WHERE id = v_job_id;
-- END;
-- $function$;
