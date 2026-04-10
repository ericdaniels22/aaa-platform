# Email Inbox UI Restructure + Auto-Categorization

**Date:** 2026-04-10
**Scope:** Replace text-based folder sidebar with icon rail; add auto-categorization tabs (General/Promotions/Social/Purchases) for inbox

## 1. Database (supabase/migration-build27-categories.sql)

Single SQL migration file following the existing `migration-*.sql` pattern (run manually in Supabase SQL editor).

### Schema changes

```sql
-- Add category column to emails
ALTER TABLE emails ADD COLUMN category text DEFAULT 'general';
CREATE INDEX idx_emails_category ON emails(category);

-- Track whether each account has had historical emails backfilled
ALTER TABLE email_accounts ADD COLUMN category_backfill_completed_at timestamptz;

-- Rules table
CREATE TABLE category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_type text NOT NULL, -- 'sender_address' | 'sender_domain' | 'header' | 'subject_pattern'
  match_value text NOT NULL,
  category text NOT NULL, -- 'promotions' | 'social' | 'purchases' (no rules needed for 'general')
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_category_rules_active ON category_rules(is_active) WHERE is_active = true;

ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on category_rules" ON category_rules FOR ALL USING (true) WITH CHECK (true);
```

### Seed data

~30 rules inserted at the bottom of the migration:

**Social (sender_domain):** facebook.com, facebookmail.com, linkedin.com, twitter.com, x.com, instagram.com, nextdoor.com, pinterest.com, reddit.com, tiktok.com, snapchat.com, messenger.com

**Promotions (sender_domain):** mailchimp.com, sendgrid.net, constantcontact.com, hubspot.com, klaviyo.com

**Promotions (header):** `list-unsubscribe` (presence of this header → promotions)

**Purchases (sender_domain):** amazon.com, paypal.com, venmo.com, square.com, stripe.com, shopify.com, ebay.com, ups.com, fedex.com, usps.com

**Purchases (subject_pattern):** `order confirm|receipt|shipping|delivered|invoice|payment received|your order` (single regex, case-insensitive)

## 2. Categorization engine (src/lib/email-categorizer.ts)

Pure synchronous function, same pattern as refactored `email-matcher.ts`.

```ts
export type Category = 'general' | 'promotions' | 'social' | 'purchases';

export interface CategoryRule {
  match_type: 'sender_address' | 'sender_domain' | 'header' | 'subject_pattern';
  match_value: string;
  category: Category;
}

export function categorizeEmail(
  email: { from_address: string; subject: string; headers?: Record<string, string> },
  rules: CategoryRule[]
): Category
```

**Match order (first match wins):**
1. `sender_address` — exact case-insensitive match on `from_address`
2. `sender_domain` — suffix match on the domain portion of `from_address` (e.g., `facebookmail.com` matches `noreply@notifications.facebookmail.com`)
3. `header` — presence of the named header (lowercased lookup) in the optional `headers` object
4. `subject_pattern` — case-insensitive regex match against `subject`

Fallback: `'general'`. Rules are pre-loaded at sync start and passed in.

## 3. Sync integration (src/app/api/email/sync/route.ts)

**Cache pre-fetch (at start of sync, alongside jobs/contacts):**
```ts
const { data: rulesData } = await supabase
  .from("category_rules")
  .select("match_type, match_value, category")
  .eq("is_active", true);
const categoryRules = (rulesData || []) as CategoryRule[];
```

**Header capture:** `simpleParser()` already exposes `parsed.headers` as a `Map`. Convert to a plain object for `list-unsubscribe` lookup:
```ts
const headers: Record<string, string> = {};
if (parsedMsg.headers) {
  for (const [key, value] of parsedMsg.headers) {
    headers[key.toLowerCase()] = String(value);
  }
}
```

**Categorize at batch insert:** Add `category` field to each row:
```ts
const category = categorizeEmail(
  { from_address: p.fromAddr, subject: p.subject, headers: p.headers },
  categoryRules
);
// include `category` in the insert row
```

The `ParsedEmail` interface gets a new `headers?: Record<string, string>` field.

**Auto-backfill:** After IMAP connection established, before the folder loop:

```ts
if (!account.category_backfill_completed_at) {
  // Backfill existing emails for this account in batches of 200
  let offset = 0;
  while (true) {
    const { data: oldEmails } = await supabase
      .from("emails")
      .select("id, from_address, subject")
      .eq("account_id", accountId)
      .eq("category", "general")
      .range(offset, offset + 199);

    if (!oldEmails || oldEmails.length === 0) break;

    // Recategorize (no headers available for historical emails — skip header rules)
    const updates: { id: string; category: Category }[] = [];
    for (const e of oldEmails) {
      const cat = categorizeEmail(
        { from_address: e.from_address, subject: e.subject },
        categoryRules
      );
      if (cat !== "general") {
        updates.push({ id: e.id, category: cat });
      }
    }

    // Apply updates (Supabase doesn't support batch update with different values per row,
    // so group by category and do one update per category)
    const byCategory = new Map<Category, string[]>();
    for (const u of updates) {
      if (!byCategory.has(u.category)) byCategory.set(u.category, []);
      byCategory.get(u.category)!.push(u.id);
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

After this one-time backfill, every subsequent sync categorizes new emails during the normal batch insert.

## 4. UI — Icon Rail (src/components/email/icon-rail.tsx)

New component extracted from `EmailInbox`. Props:

```ts
interface IconRailProps {
  folder: string;
  counts: FolderCounts;
  onFolderChange: (key: string) => void;
  onCompose: () => void;
}
```

**Structure:**
- Fixed 56px wide, `border-r border-border bg-muted/50`, `flex flex-col items-center`
- Top: Compose button (40×40, gradient background matching existing compose button styling, `SquarePen` icon, white)
- Thin divider line (`border-t border-border my-2 w-8`)
- Folder icons stacked vertically (`flex flex-col gap-1 py-2`):
  - Inbox (`Inbox`)
  - Sent (`Send`)
  - Drafts (`FileText`)
  - Trash (`Trash2`)
  - Archive (`Archive`)
  - Spam (`ShieldAlert`)
  - Starred (`Star`)
- Each icon button: 40×40, rounded, with `title` attribute for native tooltip
- Active: `bg-primary/10 text-primary`
- Inactive: `text-muted-foreground hover:bg-primary/5`
- Unread badge on Inbox: absolutely positioned pill top-right (`absolute -top-1 -right-1 bg-primary text-white text-[10px] font-bold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center`)
- Starred shows total count (not unread), same positioning, different color

## 5. UI — Category Tabs (src/components/email/category-tabs.tsx)

New component. Props:

```ts
interface CategoryTabsProps {
  category: Category;
  categoryCounts: Record<Category, number>;
  onChange: (cat: Category) => void;
}
```

**Structure:**
- Horizontal bar `border-b border-border/50 flex overflow-x-auto` (scrollable on narrow screens)
- 4 buttons: General, Promotions, Social, Purchases
- Each: `px-4 py-2 text-sm border-b-2 flex items-center gap-2`
- Active: `border-primary text-primary font-medium`
- Inactive: `border-transparent text-muted-foreground hover:text-foreground`
- Unread badge (only shown when count > 0): `text-xs font-bold text-primary bg-primary/10 rounded-full px-1.5 py-0.5 min-w-[20px] text-center`

Only rendered by the parent when `folder === 'inbox'`.

## 6. Email list API and counts

### List route (src/app/api/email/list/route.ts)

Add `category` query param handling:

```ts
const category = searchParams.get("category");
// ...
if (category && folder === "inbox") {
  query = query.eq("category", category);
}
```

Only applies filter when querying inbox (other folders show all emails in that folder regardless of category).

### Counts route (src/app/api/email/counts/route.ts)

Add `categoryUnread` field to the response:

```ts
let categoryQuery = supabase
  .from("emails")
  .select("category")
  .eq("folder", "inbox")
  .eq("is_read", false);
if (accountId) {
  categoryQuery = categoryQuery.eq("account_id", accountId);
}
const { data: categoryData } = await categoryQuery;

const categoryUnread: Record<string, number> = { general: 0, promotions: 0, social: 0, purchases: 0 };
for (const row of categoryData || []) {
  const cat = row.category || 'general';
  if (cat in categoryUnread) categoryUnread[cat]++;
}

// Add to response:
return NextResponse.json({ ...counts, categoryUnread });
```

## 7. EmailInbox integration (src/components/email-inbox.tsx)

### State changes
- **Remove:** `sidebarWidth`, its initializer, the localStorage sidebar read in the persistence effect (keep `listWidth`)
- **Add:** `const [category, setCategory] = useState<Category>('general')`
- **Add:** `const [categoryCounts, setCategoryCounts] = useState<Record<Category, number>>({ general: 0, promotions: 0, social: 0, purchases: 0 })`

### Effects
- `loadEmails` dependency array gets `category`; param string appends `&category=${category}` when `folder === 'inbox'`
- `loadCounts` also sets `categoryCounts` from response

### Handlers
- `handleFolderChange`: reset `category` to `'general'` on every folder change
- New `handleCategoryChange(cat)`: sets category, resets page to 1, clears selection

### Rendering
- Top toolbar: remove the Compose button (moves into rail), keep Sync + Settings + search + account selector
- Replace sidebar column with `<IconRail ...>` (no resize handle after it)
- Inside email list column, above the list header / bulk action bar:
  ```tsx
  {folder === 'inbox' && (
    <CategoryTabs category={category} categoryCounts={categoryCounts} onChange={handleCategoryChange} />
  )}
  ```
- Keep the resize handle between email list and reader

### localStorage key cleanup
The `email-pane-widths` key currently stores `{sidebar, list}`. After removing sidebar resize, it only stores `{list}`. The read code handles missing `sidebar` gracefully (nothing to read). The write continues to store `list` only.

## 8. Out of scope (explicitly not in this build)

- Category rules settings UI (spec says "later")
- Per-category rule editing
- Custom categories beyond the 4 defaults
- Moving emails between categories manually
- Changing the color palette, fonts, or theme
