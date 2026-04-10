-- Build 27: nav_items table for admin-configurable sidebar order
--
-- Stores only the href and sort_order for each top-level sidebar item.
-- Labels, icons, and the canonical set of items live in src/lib/nav-items.ts.
-- Items missing from this table fall to the bottom of the sidebar in the
-- code-defined order (see src/components/nav.tsx sort logic).

CREATE TABLE nav_items (
  href        text PRIMARY KEY,
  sort_order  integer NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_nav_items_updated_at
  BEFORE UPDATE ON nav_items FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Seed with the 10 current items in their current code-defined order
INSERT INTO nav_items (href, sort_order) VALUES
  ('/',          1),
  ('/jarvis',    2),
  ('/marketing', 3),
  ('/intake',    4),
  ('/jobs',      5),
  ('/photos',    6),
  ('/reports',   7),
  ('/contacts',  8),
  ('/email',     9),
  ('/settings', 10);

ALTER TABLE nav_items ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read the order
CREATE POLICY "nav_items read"
  ON nav_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only admins can insert/update/delete
CREATE POLICY "nav_items admin write"
  ON nav_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
