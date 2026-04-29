# Data sources

One card per significant Supabase table or external API. Useful when a fresh Claude needs to know "what tables matter and what builds touch them" without grepping migrations.

## What counts as significant

- A Supabase table referenced by 3+ builds
- An external API integrated into the platform (Stripe, QuickBooks, Resend, Anthropic, Twilio, etc.)
- Anything with non-obvious RLS rules, triggers, or constraints worth flagging

## Conventions

- **Filename:**
  - Tables: `{table-name}.md` (e.g. `jobs.md`, `payments.md`)
  - External APIs: `{vendor}.md` or `{vendor}-{service}.md` (e.g. `stripe.md`, `resend-email.md`)
- **Tags:** `#data-source`, plus `#table` or `#external-api`.
- **Frontmatter:**

  ```yaml
  source: jobs                   # table or vendor name
  kind: table                    # table | external-api
  created_in: build-1            # earliest build that introduced it
  altered_in: ["[[build-15]]", "[[build-18a]]"]
  rls: yes                       # for tables only
  related: ["[[build-15]]"]
  ```

- **Sections:** Purpose · Schema (key columns, relationships) · Migrations · RLS / access rules · Builds that use it · Gotchas.

The data-source cards get backfilled from migrations and code in Build 66b.
