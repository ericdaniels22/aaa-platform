-- ============================================
-- Build 27 Migration: Email Categories
-- Run this in the Supabase SQL Editor
-- ============================================

-- 1. Add category column to emails
ALTER TABLE emails ADD COLUMN category text DEFAULT 'general';
CREATE INDEX idx_emails_category ON emails(category);

-- 2. Track whether each account has had historical emails backfilled
ALTER TABLE email_accounts ADD COLUMN category_backfill_completed_at timestamptz;

-- 3. Rules table
CREATE TABLE category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_type text NOT NULL,
  match_value text NOT NULL,
  category text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_category_rules_active ON category_rules(is_active) WHERE is_active = true;

ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on category_rules" ON category_rules FOR ALL USING (true) WITH CHECK (true);

-- 4. Seed default rules

-- Social (sender_domain)
INSERT INTO category_rules (match_type, match_value, category) VALUES
  ('sender_domain', 'facebook.com', 'social'),
  ('sender_domain', 'facebookmail.com', 'social'),
  ('sender_domain', 'linkedin.com', 'social'),
  ('sender_domain', 'twitter.com', 'social'),
  ('sender_domain', 'x.com', 'social'),
  ('sender_domain', 'instagram.com', 'social'),
  ('sender_domain', 'nextdoor.com', 'social'),
  ('sender_domain', 'pinterest.com', 'social'),
  ('sender_domain', 'reddit.com', 'social'),
  ('sender_domain', 'tiktok.com', 'social'),
  ('sender_domain', 'snapchat.com', 'social'),
  ('sender_domain', 'messenger.com', 'social');

-- Promotions (sender_domain — ESPs)
INSERT INTO category_rules (match_type, match_value, category) VALUES
  ('sender_domain', 'mailchimp.com', 'promotions'),
  ('sender_domain', 'sendgrid.net', 'promotions'),
  ('sender_domain', 'constantcontact.com', 'promotions'),
  ('sender_domain', 'hubspot.com', 'promotions'),
  ('sender_domain', 'klaviyo.com', 'promotions');

-- Promotions (header presence)
INSERT INTO category_rules (match_type, match_value, category) VALUES
  ('header', 'list-unsubscribe', 'promotions');

-- Purchases (sender_domain)
INSERT INTO category_rules (match_type, match_value, category) VALUES
  ('sender_domain', 'amazon.com', 'purchases'),
  ('sender_domain', 'paypal.com', 'purchases'),
  ('sender_domain', 'venmo.com', 'purchases'),
  ('sender_domain', 'square.com', 'purchases'),
  ('sender_domain', 'stripe.com', 'purchases'),
  ('sender_domain', 'shopify.com', 'purchases'),
  ('sender_domain', 'ebay.com', 'purchases'),
  ('sender_domain', 'ups.com', 'purchases'),
  ('sender_domain', 'fedex.com', 'purchases'),
  ('sender_domain', 'usps.com', 'purchases');

-- Purchases (subject pattern)
INSERT INTO category_rules (match_type, match_value, category) VALUES
  ('subject_pattern', 'order confirm|receipt|shipping|delivered|invoice|payment received|your order', 'purchases');
