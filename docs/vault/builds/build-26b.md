---
build_id: 26b
title: Marketing sub-agent + drafts/image library
status: shipped
phase: jarvis-ecosystem
started: null
shipped: null
guide_doc: null
plan_file: null
handoff: null
related: ["[[build-21]]", "[[build-23]]", "[[build-25a]]", "[[jarvis]]"]
---

#status/shipped #area/jarvis #area/marketing #build/26b

## What shipped

Marketing specialist sub-agent for Jarvis plus a dedicated `/marketing` page with social-media drafts and an image library. Bundled with Build 2.6a in commit `99fde06`.

- **Migration:** [supabase/migration-build26b.sql](../../../supabase/migration-build26b.sql) — `marketing_assets` (file_name, storage_path, tags GIN), `marketing_drafts`.
- **Routes:**
  - **Page:** `/marketing` (admin-gated; SocialMedia + Chat tabs) — see [src/app/marketing/page.tsx](../../../src/app/marketing/page.tsx).
  - **API (data):** `/api/marketing/assets`, `/api/marketing/drafts`.
  - **API (agent):** `/api/jarvis/marketing` (specialist endpoint, also reachable via `consult_marketing` tool from Jarvis Core, also surfaced as a mode in `/jarvis`).
- **Components:** [src/components/marketing/](../../../src/components/marketing/) — DraftCard, DraftDetailSheet, ImageLibrary, ImagePickerDialog, MarketingChatTab, SocialMediaTab.
- **Marketing tools:** `web_search`, `get_business_info`, `get_services_list`. Claude Sonnet, `max_tokens: 8192`, `timeout: 60s`.
- **System prompt:** [src/lib/jarvis/prompts/marketing.ts](../../../src/lib/jarvis/prompts/marketing.ts).

## Source

- Commit: `99fde06 feat: Build 2.6a + 2.6b — Marketing sub-agent, dedicated page, drafts & image library`
- Migration: [supabase/migration-build26b.sql](../../../supabase/migration-build26b.sql)
- Guide: none
