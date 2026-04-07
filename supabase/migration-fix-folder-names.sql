-- ============================================
-- Fix: Normalize email folder names
-- Run this in the Supabase SQL Editor
-- ============================================

-- Map known IMAP folder variants to normalized names
UPDATE emails SET folder = 'inbox' WHERE lower(folder) = 'inbox' AND folder != 'inbox';
UPDATE emails SET folder = 'sent' WHERE lower(folder) IN ('sent', 'sent messages', 'sent items', 'sent mail', '[gmail]/sent mail', 'inbox.sent') AND folder != 'sent';
UPDATE emails SET folder = 'drafts' WHERE lower(folder) IN ('drafts', 'draft', '[gmail]/drafts', 'inbox.drafts') AND folder != 'drafts';
UPDATE emails SET folder = 'trash' WHERE lower(folder) IN ('trash', 'deleted items', 'deleted messages', 'bin', '[gmail]/trash', 'inbox.trash') AND folder != 'trash';
UPDATE emails SET folder = 'spam' WHERE lower(folder) IN ('spam', 'junk', 'junk e-mail', 'bulk mail', '[gmail]/spam', 'inbox.spam', 'inbox.junk') AND folder != 'spam';
UPDATE emails SET folder = 'archive' WHERE lower(folder) IN ('archive', 'archives', 'all mail', '[gmail]/all mail') AND folder != 'archive';

-- Lowercase any remaining non-standard folder names
UPDATE emails SET folder = lower(folder) WHERE folder != lower(folder);
