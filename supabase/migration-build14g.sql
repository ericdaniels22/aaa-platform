-- ============================================
-- Build 14g Migration: Notifications
-- Run this in the Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. NOTIFICATIONS
-- ============================================
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'new_job', 'status_change', 'payment', 'activity',
    'photo', 'email', 'overdue', 'reminder'
  )),
  title text NOT NULL,
  body text,
  is_read boolean NOT NULL DEFAULT false,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 2. NOTIFICATION PREFERENCES
-- ============================================
CREATE TABLE notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  delivery_method text NOT NULL DEFAULT 'in_app'
    CHECK (delivery_method IN ('off', 'in_app', 'email', 'both')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, notification_type)
);

-- ============================================
-- 3. TIMESTAMPS + RLS
-- ============================================
CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on notifications" ON notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on notification_preferences" ON notification_preferences FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 4. INDEXES
-- ============================================
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notification_preferences_user_id ON notification_preferences(user_id);

-- ============================================
-- 5. HELPER: Create notification for all admins
-- ============================================
CREATE OR REPLACE FUNCTION notify_admins(
  p_type text,
  p_title text,
  p_body text DEFAULT NULL,
  p_job_id uuid DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO notifications (user_id, type, title, body, job_id)
  SELECT id, p_type, p_title, p_body, p_job_id
  FROM user_profiles
  WHERE role = 'admin' AND is_active = true;
END;
$$ LANGUAGE plpgsql;
