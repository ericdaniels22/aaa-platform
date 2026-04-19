-- ============================================
-- Build 34 Migration: Build 15c — In-person signing, multi-signer, reminders
-- Adds RPCs for:
--   * create_contract_with_signers (atomic create + signer rows, with or
--     without a link token — supports both remote multi-signer create and
--     in-person draft create)
--   * activate_next_signer (after signer 1 completes on multi-signer remote,
--     rotates contracts.link_token to signer 2's token and resets reminders)
--   * schedule_first_reminder (set initial next_reminder_at after send)
--   * mark_reminder_sent (atomic: count++, recompute next_reminder_at
--     from offsets, log audit event)
-- No schema column additions; contract.link_token is rotated across
-- signers rather than stored per-signer. Run this in the Supabase SQL
-- Editor. Not idempotent.
-- ============================================

-- ============================================
-- 1. create_contract_with_signers
-- Replaces the single-signer create_contract_draft for 15c paths. Handles
-- 1-2 signers, with or without a link token. p_signers is a JSON array:
--   [{ id, signer_order, role_label, name, email }, ...]
-- p_link_token/p_link_expires_at can be NULL for in-person creates.
-- ============================================
CREATE OR REPLACE FUNCTION create_contract_with_signers(
  p_contract_id uuid,
  p_job_id uuid,
  p_template_id uuid,
  p_template_version integer,
  p_title text,
  p_filled_content_html text,
  p_filled_content_hash text,
  p_link_token text,
  p_link_expires_at timestamptz,
  p_sent_by uuid,
  p_signers jsonb
) RETURNS uuid AS $$
DECLARE
  signer jsonb;
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

  FOR signer IN SELECT * FROM jsonb_array_elements(p_signers) LOOP
    INSERT INTO contract_signers (
      id, contract_id, signer_order, role_label, name, email
    ) VALUES (
      (signer->>'id')::uuid,
      p_contract_id,
      (signer->>'signer_order')::integer,
      signer->>'role_label',
      signer->>'name',
      signer->>'email'
    );
  END LOOP;

  INSERT INTO contract_events (contract_id, event_type)
  VALUES (p_contract_id, 'created');

  RETURN p_contract_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 2. activate_next_signer
-- Rotates contracts.link_token to the next signer's token and resets
-- per-signer view + reminder state so the new signer gets a clean slate.
-- Called after signer N completes but more signers remain.
-- ============================================
CREATE OR REPLACE FUNCTION activate_next_signer(
  p_contract_id uuid,
  p_next_signer_id uuid,
  p_link_token text,
  p_link_expires_at timestamptz
) RETURNS void AS $$
BEGIN
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

  INSERT INTO contract_events (contract_id, signer_id, event_type, metadata)
  VALUES (
    p_contract_id, p_next_signer_id, 'sent',
    jsonb_build_object('activated_next_signer', true)
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. schedule_first_reminder
-- Called after mark_contract_sent (and after activate_next_signer) to
-- stamp the initial next_reminder_at. Kept as its own RPC so /send and
-- /sign remain simple and the transition is auditable.
-- ============================================
CREATE OR REPLACE FUNCTION schedule_first_reminder(
  p_contract_id uuid,
  p_next_reminder_at timestamptz
) RETURNS void AS $$
BEGIN
  UPDATE contracts
    SET next_reminder_at = p_next_reminder_at
    WHERE id = p_contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract % not found', p_contract_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. mark_reminder_sent
-- Atomic: increment reminder_count, recompute next_reminder_at from the
-- settings offsets array, write the 'reminder_sent' event.
--   offsets = [1, 3]
--   count 0 → next_reminder_at = sent_at + 1 day (set at send time)
--   after first reminder fires: count = 1, next = sent_at + 3 days
--   after second fires: count = 2, next = NULL (no more auto reminders)
-- Row-level lock on contracts serializes concurrent cron workers.
-- ============================================
CREATE OR REPLACE FUNCTION mark_reminder_sent(
  p_contract_id uuid,
  p_offsets jsonb
) RETURNS void AS $$
DECLARE
  v_sent_at timestamptz;
  v_new_count integer;
  v_next timestamptz;
  v_offset_count integer;
  v_next_offset integer;
BEGIN
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

  INSERT INTO contract_events (contract_id, event_type, metadata)
  VALUES (
    p_contract_id, 'reminder_sent',
    jsonb_build_object('reminder_count', v_new_count)
  );
END;
$$ LANGUAGE plpgsql;
