-- ============================================
-- Build 28 Migration: Body-pattern rules + re-backfill
-- Run this in the Supabase SQL Editor
-- ============================================

-- 1. Add body_pattern rules for promotional email detection.
-- These match against body_text (fetched during sync, stored per email).
-- Order of insertion doesn't matter; the categorizer iterates all of them.

INSERT INTO category_rules (match_type, match_value, category) VALUES
  ('body_pattern', 'unsubscribe', 'promotions'),
  ('body_pattern', 'view (this |it )?(in|on) (your )?browser', 'promotions'),
  ('body_pattern', '(update|manage) your (email )?(preferences|subscription)', 'promotions'),
  ('body_pattern', 'opt.?out', 'promotions'),
  ('body_pattern', 'stop receiving (these )?emails', 'promotions'),
  ('body_pattern', 'email preferences', 'promotions'),
  ('body_pattern', 'you.{1,10}receiv(ed|ing) this (email|message) because', 'promotions');

-- 2. Reset backfill flag on all accounts so the next sync re-runs the
-- enhanced backfill with body_pattern matching + IMAP header re-fetch.
-- This only affects emails still categorized as 'general' — already
-- categorized emails (social, purchases, etc.) are untouched by the
-- backfill query which filters WHERE category = 'general'.

UPDATE email_accounts SET category_backfill_completed_at = NULL;
