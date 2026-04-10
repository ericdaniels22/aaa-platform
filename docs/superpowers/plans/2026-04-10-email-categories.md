# Email Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace text folder sidebar with icon rail, add auto-categorization tabs (General/Promotions/Social/Purchases) for inbox, categorize new and historical emails using configurable rules.

**Architecture:** Database migration adds a `category` column and a `category_rules` seed table. A pure-function categorizer runs during sync and during a one-time per-account backfill. UI extracts `IconRail` and `CategoryTabs` into separate files to keep `email-inbox.tsx` maintainable.

**Tech Stack:** Next.js 16, React 19, Supabase, TypeScript, Tailwind CSS, Lucide icons

**Spec:** `docs/superpowers/specs/2026-04-10-email-categories-design.md`

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migration-build27-categories.sql`

- [ ] **Step 1: Create the migration SQL file**

Create `supabase/migration-build27-categories.sql` with the following content:

```sql
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
```

- [ ] **Step 2: User runs migration in Supabase SQL Editor**

**This is a manual step.** The engineer does NOT run this via psql or CLI. Tell the user to copy the contents of `supabase/migration-build27-categories.sql` into the Supabase SQL Editor and run it. Wait for confirmation before proceeding to Task 2.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration-build27-categories.sql
git commit -m "feat(db): add category column, rules table, and default seed"
```

---

## Task 2: Categorizer Module

**Files:**
- Create: `src/lib/email-categorizer.ts`

- [ ] **Step 1: Create the categorizer file**

Create `src/lib/email-categorizer.ts` with the following content:

```ts
export type Category = "general" | "promotions" | "social" | "purchases";

export interface CategoryRule {
  match_type: "sender_address" | "sender_domain" | "header" | "subject_pattern";
  match_value: string;
  category: Category;
}

export interface EmailForCategorization {
  from_address: string;
  subject: string;
  headers?: Record<string, string>;
}

/**
 * Categorize an email by matching against a pre-loaded list of rules.
 * Match order (first match wins):
 *   1. sender_address (exact, case-insensitive)
 *   2. sender_domain (suffix match on domain portion of from_address)
 *   3. header (case-insensitive presence of the named header)
 *   4. subject_pattern (case-insensitive regex match against subject)
 * Fallback: "general".
 */
export function categorizeEmail(
  email: EmailForCategorization,
  rules: CategoryRule[]
): Category {
  const fromLower = email.from_address.toLowerCase();
  const subject = email.subject || "";
  const headers = email.headers || {};

  // Extract domain from "name@domain.tld" — take everything after the last "@"
  const atIdx = fromLower.lastIndexOf("@");
  const fromDomain = atIdx >= 0 ? fromLower.slice(atIdx + 1) : "";

  // 1. sender_address exact match
  for (const rule of rules) {
    if (rule.match_type === "sender_address") {
      if (rule.match_value.toLowerCase() === fromLower) {
        return rule.category;
      }
    }
  }

  // 2. sender_domain suffix match
  for (const rule of rules) {
    if (rule.match_type === "sender_domain") {
      const target = rule.match_value.toLowerCase();
      if (fromDomain === target || fromDomain.endsWith("." + target)) {
        return rule.category;
      }
    }
  }

  // 3. header presence
  for (const rule of rules) {
    if (rule.match_type === "header") {
      const headerName = rule.match_value.toLowerCase();
      if (headerName in headers) {
        return rule.category;
      }
    }
  }

  // 4. subject_pattern regex
  for (const rule of rules) {
    if (rule.match_type === "subject_pattern") {
      try {
        const re = new RegExp(rule.match_value, "i");
        if (re.test(subject)) {
          return rule.category;
        }
      } catch {
        // Invalid regex in DB — skip
      }
    }
  }

  return "general";
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit src/lib/email-categorizer.ts 2>&1 | head -20`
Expected: no errors (or the command may not take a single file — use `npx next build 2>&1 | tail -5` as an alternative).

- [ ] **Step 3: Commit**

```bash
git add src/lib/email-categorizer.ts
git commit -m "feat(email): add email-categorizer utility"
```

---

## Task 3: List API — Category Filter

**Files:**
- Modify: `src/app/api/email/list/route.ts`

- [ ] **Step 1: Add category query param support**

Open `src/app/api/email/list/route.ts`. Find the block that reads search params and add a `category` read. Find:

```ts
  const folder = searchParams.get("folder") || "inbox";
  const accountId = searchParams.get("accountId"); // null = all accounts
  const search = searchParams.get("search") || "";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const starred = searchParams.get("starred");
```

Add a `category` line after `starred`:

```ts
  const folder = searchParams.get("folder") || "inbox";
  const accountId = searchParams.get("accountId"); // null = all accounts
  const search = searchParams.get("search") || "";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const starred = searchParams.get("starred");
  const category = searchParams.get("category");
```

- [ ] **Step 2: Apply the category filter when folder is inbox**

Find the block that applies folder/account/search filters. After the account filter and before the search filter, add:

```ts
  // Filter by category (only applies to inbox)
  if (category && folder === "inbox" && starred !== "true") {
    query = query.eq("category", category);
  }
```

The complete sequence of filters should end up looking like:

```ts
  // Filter by folder (unless showing starred across all folders)
  if (starred === "true") {
    query = query.eq("is_starred", true);
  } else {
    query = query.eq("folder", folder);
  }

  // Filter by account
  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  // Filter by category (only applies to inbox)
  if (category && folder === "inbox" && starred !== "true") {
    query = query.eq("category", category);
  }

  // Search in subject, from_address, from_name, snippet
  if (search) {
    query = query.or(
      `subject.ilike.%${search}%,from_address.ilike.%${search}%,from_name.ilike.%${search}%,snippet.ilike.%${search}%`
    );
  }
```

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/email/list/route.ts
git commit -m "feat(email): support category filter in list API"
```

---

## Task 4: Counts API — Category Unread

**Files:**
- Modify: `src/app/api/email/counts/route.ts`

- [ ] **Step 1: Add category unread aggregation**

Open `src/app/api/email/counts/route.ts`. After the starred count block (before the final `return NextResponse.json(counts);`), add:

```ts
  // Category unread counts for inbox only
  let categoryQuery = supabase
    .from("emails")
    .select("category")
    .eq("folder", "inbox")
    .eq("is_read", false);

  if (accountId) {
    categoryQuery = categoryQuery.eq("account_id", accountId);
  }

  const { data: categoryData } = await categoryQuery;

  const categoryUnread: Record<string, number> = {
    general: 0,
    promotions: 0,
    social: 0,
    purchases: 0,
  };

  for (const row of (categoryData || []) as { category: string | null }[]) {
    const cat = row.category || "general";
    if (cat in categoryUnread) categoryUnread[cat]++;
  }
```

- [ ] **Step 2: Include categoryUnread in the response**

Change the return statement from:

```ts
  return NextResponse.json(counts);
```

to:

```ts
  return NextResponse.json({ ...counts, categoryUnread });
```

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/email/counts/route.ts
git commit -m "feat(email): add categoryUnread to counts API response"
```

---

## Task 5: Sync — Categorize New Emails

**Files:**
- Modify: `src/app/api/email/sync/route.ts`

- [ ] **Step 1: Import categorizer and extend ParsedEmail**

Open `src/app/api/email/sync/route.ts`. Add an import after the existing imports at the top:

```ts
import { categorizeEmail, type CategoryRule, type Category } from "@/lib/email-categorizer";
```

Find the `ParsedEmail` interface near the top of the file and add a `headers` field:

```ts
interface ParsedEmail {
  uid: number;
  messageId: string;
  threadId: string;
  fromAddr: string;
  fromName: string | null;
  toAddresses: { email: string; name?: string }[];
  ccAddresses: { email: string; name?: string }[];
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  hasAttachments: boolean;
  receivedAt: Date;
  parsedAttachments: Attachment[];
  headers: Record<string, string>;
}
```

- [ ] **Step 2: Pre-fetch category rules alongside jobs/contacts cache**

Find the block that pre-fetches jobs and contacts (around `// Pre-fetch job matching cache`). After the `matcherCache` assignment, add:

```ts
    // Pre-fetch category rules (once for entire sync)
    const { data: rulesData } = await supabase
      .from("category_rules")
      .select("match_type, match_value, category")
      .eq("is_active", true);
    const categoryRules = (rulesData || []) as CategoryRule[];
```

- [ ] **Step 3: Capture headers during message parsing**

Find the block inside the message loop that does `const parsedMsg = await simpleParser(msg.source);`. After it, before the `hasAttachments` update, add header extraction. The current code looks like:

```ts
            if (msg.source) {
              const parsedMsg = await simpleParser(msg.source);
              bodyText = parsedMsg.text || "";
              bodyHtml = typeof parsedMsg.html === "string" ? parsedMsg.html : "";
              msgAttachments = parsedMsg.attachments || [];
              hasAttachments = msgAttachments.length > 0;
            }
```

Replace with:

```ts
            let msgHeaders: Record<string, string> = {};
            if (msg.source) {
              const parsedMsg = await simpleParser(msg.source);
              bodyText = parsedMsg.text || "";
              bodyHtml = typeof parsedMsg.html === "string" ? parsedMsg.html : "";
              msgAttachments = parsedMsg.attachments || [];
              hasAttachments = msgAttachments.length > 0;
              // Flatten mailparser headers Map to a lowercased plain object
              if (parsedMsg.headers) {
                for (const [key, value] of parsedMsg.headers) {
                  msgHeaders[key.toLowerCase()] = String(value);
                }
              }
            }
```

- [ ] **Step 4: Add headers to the ParsedEmail push**

Find the `parsed.push({ ... })` call in the sync route. Add `headers: msgHeaders,` at the end of the object literal, before the closing `});`. The push should look like:

```ts
            parsed.push({
              uid,
              messageId,
              threadId,
              fromAddr,
              fromName: fromName || null,
              toAddresses,
              ccAddresses,
              subject,
              bodyText: bodyText || null,
              bodyHtml: bodyHtml || null,
              snippet: snippet || null,
              hasAttachments,
              receivedAt: date,
              parsedAttachments: msgAttachments,
              headers: msgHeaders,
            });
```

- [ ] **Step 5: Categorize during batch insert**

Find the batch insert `rows = parsed.map((p) => { ... })` block. Inside the map callback, after the `match = matchEmailToJob(...)` call and before the return statement, add the categorization call. Then include `category` in the returned row.

The existing code:

```ts
          const rows = parsed.map((p) => {
            const match = matchEmailToJob(
              matcherCache,
              { from_address: p.fromAddr, to_addresses: p.toAddresses, subject: p.subject, body_text: p.bodyText },
              account.email_address
            );

            return {
              account_id: accountId,
              job_id: match?.job_id || null,
              ...
              received_at: p.receivedAt,
            };
          });
```

Update it to:

```ts
          const rows = parsed.map((p) => {
            const match = matchEmailToJob(
              matcherCache,
              { from_address: p.fromAddr, to_addresses: p.toAddresses, subject: p.subject, body_text: p.bodyText },
              account.email_address
            );

            const category = categorizeEmail(
              { from_address: p.fromAddr, subject: p.subject, headers: p.headers },
              categoryRules
            );

            return {
              account_id: accountId,
              job_id: match?.job_id || null,
              message_id: p.messageId,
              thread_id: p.threadId,
              folder,
              from_address: p.fromAddr,
              from_name: p.fromName,
              to_addresses: p.toAddresses,
              cc_addresses: p.ccAddresses,
              bcc_addresses: [],
              subject: p.subject,
              body_text: p.bodyText,
              body_html: p.bodyHtml,
              snippet: p.snippet,
              is_read: folder === "sent" || folder === "drafts",
              is_starred: false,
              has_attachments: p.hasAttachments,
              matched_by: match?.matched_by || null,
              uid: p.uid,
              received_at: p.receivedAt,
              category,
            };
          });
```

- [ ] **Step 6: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/email/sync/route.ts
git commit -m "feat(email): categorize new emails during sync"
```

---

## Task 6: Sync — Auto-Backfill

**Files:**
- Modify: `src/app/api/email/sync/route.ts`

- [ ] **Step 1: Add backfill block after categoryRules fetch**

Open `src/app/api/email/sync/route.ts`. Find the `const categoryRules = ...` line added in Task 5. Immediately after it, insert the backfill block:

```ts
    // One-time per-account backfill of historical emails
    if (!account.category_backfill_completed_at) {
      let offset = 0;
      while (true) {
        const { data: oldEmails } = await supabase
          .from("emails")
          .select("id, from_address, subject")
          .eq("account_id", accountId)
          .eq("category", "general")
          .range(offset, offset + 199);

        if (!oldEmails || oldEmails.length === 0) break;

        const byCategory = new Map<Category, string[]>();
        for (const e of oldEmails as { id: string; from_address: string; subject: string }[]) {
          const cat = categorizeEmail(
            { from_address: e.from_address, subject: e.subject },
            categoryRules
          );
          if (cat !== "general") {
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat)!.push(e.id);
          }
        }

        for (const [cat, ids] of byCategory) {
          await supabase.from("emails").update({ category: cat }).in("id", ids);
        }

        if (oldEmails.length < 200) break;
        offset += 200;
      }

      await supabase
        .from("email_accounts")
        .update({ category_backfill_completed_at: new Date().toISOString() })
        .eq("id", accountId);
    }
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/email/sync/route.ts
git commit -m "feat(email): auto-backfill historical emails on first sync"
```

---

## Task 7: IconRail Component

**Files:**
- Create: `src/components/email/icon-rail.tsx`

- [ ] **Step 1: Create the component**

First ensure the directory exists:

```bash
mkdir -p src/components/email
```

Create `src/components/email/icon-rail.tsx`:

```tsx
"use client";

import {
  Inbox,
  Send,
  FileText,
  Trash2,
  Archive,
  ShieldAlert,
  Star,
  SquarePen,
} from "lucide-react";

interface FolderCounts {
  [key: string]: { total: number; unread: number };
}

interface IconRailProps {
  folder: string;
  counts: FolderCounts;
  onFolderChange: (key: string) => void;
  onCompose: () => void;
}

const FOLDER_ICONS = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "sent", label: "Sent", icon: Send },
  { key: "drafts", label: "Drafts", icon: FileText },
  { key: "trash", label: "Trash", icon: Trash2 },
  { key: "archive", label: "Archive", icon: Archive },
  { key: "spam", label: "Spam", icon: ShieldAlert },
  { key: "starred", label: "Starred", icon: Star },
];

export default function IconRail({
  folder,
  counts,
  onFolderChange,
  onCompose,
}: IconRailProps) {
  return (
    <div className="w-14 border-r border-border bg-muted/50 shrink-0 flex flex-col items-center py-2 gap-1">
      {/* Compose button */}
      <button
        onClick={onCompose}
        className="w-10 h-10 rounded-lg bg-[image:var(--gradient-primary)] text-white flex items-center justify-center shadow-sm hover:brightness-110 hover:shadow-md transition-all"
        title="Compose"
      >
        <SquarePen size={18} />
      </button>

      {/* Divider */}
      <div className="border-t border-border my-2 w-8" />

      {/* Folder icons */}
      {FOLDER_ICONS.map(({ key, label, icon: Icon }) => {
        const isActive = folder === key;
        const unread = counts[key]?.unread || 0;
        const total = counts[key]?.total || 0;
        const showBadge =
          (key === "inbox" && unread > 0) ||
          (key === "starred" && total > 0);
        const badgeValue = key === "starred" ? total : unread;

        return (
          <button
            key={key}
            onClick={() => onFolderChange(key)}
            title={label}
            className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-primary/5"
            }`}
          >
            <Icon size={18} />
            {showBadge && (
              <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] font-bold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center">
                {badgeValue > 99 ? "99+" : badgeValue}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/email/icon-rail.tsx
git commit -m "feat(email): add IconRail component"
```

---

## Task 8: CategoryTabs Component

**Files:**
- Create: `src/components/email/category-tabs.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/email/category-tabs.tsx`:

```tsx
"use client";

import type { Category } from "@/lib/email-categorizer";

interface CategoryTabsProps {
  category: Category;
  categoryCounts: Record<string, number>;
  onChange: (cat: Category) => void;
}

const TABS: { key: Category; label: string }[] = [
  { key: "general", label: "General" },
  { key: "promotions", label: "Promotions" },
  { key: "social", label: "Social" },
  { key: "purchases", label: "Purchases" },
];

export default function CategoryTabs({
  category,
  categoryCounts,
  onChange,
}: CategoryTabsProps) {
  return (
    <div className="flex overflow-x-auto border-b border-border/50 shrink-0">
      {TABS.map(({ key, label }) => {
        const isActive = category === key;
        const unread = categoryCounts[key] || 0;

        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`px-4 py-2 text-sm flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
              isActive
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            {unread > 0 && (
              <span className="text-xs font-bold text-primary bg-primary/10 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/email/category-tabs.tsx
git commit -m "feat(email): add CategoryTabs component"
```

---

## Task 9: EmailInbox — Integrate IconRail and Categories

**Files:**
- Modify: `src/components/email-inbox.tsx`

This is the largest task. It integrates the new components, adds category state, removes sidebar resize state, and cleans up the top toolbar.

- [ ] **Step 1: Update imports**

Open `src/components/email-inbox.tsx`. Replace the existing lucide-react import block:

```ts
import {
  Inbox,
  Send,
  FileEdit,
  Trash2,
  Archive,
  AlertCircle,
  Star,
  Search,
  RefreshCw,
  Paperclip,
  Briefcase,
  MailPlus,
  MailCheck,
  ChevronDown,
  Settings,
  X,
} from "lucide-react";
```

With (removing unused folder icons now that IconRail owns them, and removing MailPlus since Compose moves to the rail):

```ts
import {
  Inbox,
  Trash2,
  Archive,
  Star,
  Search,
  RefreshCw,
  Paperclip,
  Briefcase,
  MailCheck,
  ChevronDown,
  Settings,
  X,
} from "lucide-react";
```

Then add imports for the new components and the Category type after the existing `import ComposeEmailModal from "@/components/compose-email";` line:

```ts
import IconRail from "@/components/email/icon-rail";
import CategoryTabs from "@/components/email/category-tabs";
import type { Category } from "@/lib/email-categorizer";
```

- [ ] **Step 2: Remove the FOLDERS constant**

Find and delete the existing `FOLDERS` constant block (it's no longer used in EmailInbox — IconRail has its own):

```ts
const FOLDERS = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "sent", label: "Sent", icon: Send },
  { key: "drafts", label: "Drafts", icon: FileEdit },
  { key: "trash", label: "Trash", icon: Trash2 },
  { key: "archive", label: "Archive", icon: Archive },
  { key: "spam", label: "Spam", icon: AlertCircle },
  { key: "starred", label: "Starred", icon: Star },
];
```

- [ ] **Step 3: Remove sidebar width state and its initializer**

Find and delete this block:

```ts
  // Resizable pane widths
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 208;
    try {
      const saved = localStorage.getItem("email-pane-widths");
      if (saved) return JSON.parse(saved).sidebar ?? 208;
    } catch {}
    return 208;
  });
```

The `listWidth` state stays. Then update the persistence effect (which currently writes both sidebar and list) to write only list:

Find:

```ts
  // Persist widths to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        "email-pane-widths",
        JSON.stringify({ sidebar: sidebarWidth, list: listWidth })
      );
    } catch {}
  }, [sidebarWidth, listWidth]);
```

Replace with:

```ts
  // Persist list width to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        "email-pane-widths",
        JSON.stringify({ list: listWidth })
      );
    } catch {}
  }, [listWidth]);
```

- [ ] **Step 4: Add category state**

Find the block that declares `selectedEmailId` state. After it (or before the resizable pane comments that you just cleaned up), add:

```ts
  // Category filter (inbox only)
  const [category, setCategory] = useState<Category>("general");
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({
    general: 0,
    promotions: 0,
    social: 0,
    purchases: 0,
  });
```

- [ ] **Step 5: Include category in loadEmails**

Find the `loadEmails` useCallback:

```ts
  const loadEmails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (folder === "starred") {
        params.set("starred", "true");
      } else {
        params.set("folder", folder);
      }
      if (selectedAccountId) params.set("accountId", selectedAccountId);
      if (searchDebounced) params.set("search", searchDebounced);
      params.set("page", page.toString());

      const res = await fetch(`/api/email/list?${params}`);
      const data: ListResponse = await res.json();
      setEmails(data.emails);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch {
      toast.error("Failed to load emails");
    }
    setLoading(false);
  }, [folder, selectedAccountId, searchDebounced, page]);
```

Replace with:

```ts
  const loadEmails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (folder === "starred") {
        params.set("starred", "true");
      } else {
        params.set("folder", folder);
      }
      if (selectedAccountId) params.set("accountId", selectedAccountId);
      if (searchDebounced) params.set("search", searchDebounced);
      params.set("page", page.toString());
      if (folder === "inbox") params.set("category", category);

      const res = await fetch(`/api/email/list?${params}`);
      const data: ListResponse = await res.json();
      setEmails(data.emails);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch {
      toast.error("Failed to load emails");
    }
    setLoading(false);
  }, [folder, selectedAccountId, searchDebounced, page, category]);
```

- [ ] **Step 6: Update loadCounts to read categoryUnread**

Find the `loadCounts` useCallback:

```ts
  const loadCounts = useCallback(async () => {
    try {
      const params = selectedAccountId
        ? `?accountId=${selectedAccountId}`
        : "";
      const res = await fetch(`/api/email/counts${params}`);
      const data = await res.json();
      setCounts(data);
    } catch {
      // silent
    }
  }, [selectedAccountId]);
```

Replace with:

```ts
  const loadCounts = useCallback(async () => {
    try {
      const params = selectedAccountId
        ? `?accountId=${selectedAccountId}`
        : "";
      const res = await fetch(`/api/email/counts${params}`);
      const data = await res.json();
      setCounts(data);
      if (data.categoryUnread) {
        setCategoryCounts(data.categoryUnread);
      }
    } catch {
      // silent
    }
  }, [selectedAccountId]);
```

- [ ] **Step 7: Update handleFolderChange to reset category**

Find:

```ts
  function handleFolderChange(key: string) {
    setFolder(key);
    setPage(1);
    setSelectedEmailId(null);
    setSelectedIds(new Set());
  }
```

Replace with:

```ts
  function handleFolderChange(key: string) {
    setFolder(key);
    setPage(1);
    setSelectedEmailId(null);
    setSelectedIds(new Set());
    setCategory("general");
  }
```

- [ ] **Step 8: Add handleCategoryChange**

After `handleFolderChange`, add:

```ts
  function handleCategoryChange(cat: Category) {
    setCategory(cat);
    setPage(1);
    setSelectedEmailId(null);
    setSelectedIds(new Set());
  }
```

- [ ] **Step 9: Remove Compose button from top toolbar**

Find the Compose button in the top bar (inside the `{/* Top bar */}` div). It looks like:

```tsx
          <button
            onClick={handleCompose}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[image:var(--gradient-primary)] text-white rounded-lg text-sm font-medium shadow-sm hover:brightness-110 hover:shadow-md transition-all"
          >
            <MailPlus size={14} />
            Compose
          </button>
```

Delete the entire button (it moves into the IconRail).

- [ ] **Step 10: Replace the sidebar column with IconRail**

Find the 3-column layout section. The current sidebar column looks like:

```tsx
        {/* Column 1: Folder sidebar */}
        <div style={{ width: sidebarWidth }} className="border-r border-border bg-muted/50 shrink-0 flex flex-col">
          <nav className="flex-1 py-2">
            {FOLDERS.map(({ key, label, icon: Icon }) => {
              const isActive = folder === key;
              const unread = counts[key]?.unread || 0;
              const total2 = counts[key]?.total || 0;

              return (
                <button
                  key={key}
                  onClick={() => handleFolderChange(key)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-primary/5"
                  }`}
                >
                  <Icon size={16} />
                  <span className="flex-1 text-left">{label}</span>
                  {key === "starred" && total2 > 0 && (
                    <span className="text-xs text-muted-foreground/60">{total2}</span>
                  )}
                  {key !== "starred" && unread > 0 && (
                    <span className="text-xs font-bold text-primary bg-primary/10 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <ResizeHandle
          onResize={(delta) => {
            setSidebarWidth((prev: number) => Math.min(300, Math.max(160, prev + delta)));
          }}
        />
```

Replace this entire block (the sidebar div AND the ResizeHandle that follows it) with:

```tsx
        {/* Column 1: Icon rail */}
        <IconRail
          folder={folder}
          counts={counts}
          onFolderChange={handleFolderChange}
          onCompose={handleCompose}
        />
```

- [ ] **Step 11: Render CategoryTabs above the list header**

Find the email list column (it begins with `{/* Column 2: Email list */}`). Inside it, find the list header block (it starts with `{/* List header / Bulk action bar */}`). Immediately BEFORE the list header div, add:

```tsx
          {folder === "inbox" && (
            <CategoryTabs
              category={category}
              categoryCounts={categoryCounts}
              onChange={handleCategoryChange}
            />
          )}
```

- [ ] **Step 12: Verify build**

Run: `npx next build 2>&1 | tail -10`
Expected: build succeeds with no errors.

- [ ] **Step 13: Commit**

```bash
git add src/components/email-inbox.tsx
git commit -m "feat(email): integrate IconRail and CategoryTabs into EmailInbox"
```

---

## Task 10: Manual Verification

**Files:** None

- [ ] **Step 1: Start the dev server and navigate to /email**

Run: `npm run dev`
Open `http://localhost:3000/email` in the browser.

- [ ] **Step 2: Visual checks**

Verify:
1. Left side shows a narrow (56px) icon rail with Compose button at top, then folder icons stacked vertically
2. Hovering over each icon shows a tooltip with the folder name
3. Inbox has an unread count badge in the top-right corner
4. Active folder icon is highlighted with `bg-primary/10 text-primary`
5. Between the top toolbar and the email list, 4 tabs appear: General, Promotions, Social, Purchases
6. Tabs are only visible when viewing Inbox (switch to Sent/Drafts — tabs disappear)
7. The top toolbar no longer has a Compose button (it's in the rail)
8. Clicking Compose in the rail opens the compose modal
9. Clicking a category tab filters the email list (may initially show the same emails until backfill runs)

- [ ] **Step 3: Test backfill + categorization by running a sync**

Click "Sync" in the top toolbar. Wait for completion. Navigate between General/Promotions/Social/Purchases tabs — emails from social networks should now appear in Social, Amazon/UPS/etc. in Purchases, mailchimp/list-unsubscribe senders in Promotions.

- [ ] **Step 4: No commit for this task**

This is a verification task. If any check fails, report back and fix the relevant prior task.
