---
build_id: 14g
title: Notifications bell & preferences
status: shipped
phase: settings
started: null
shipped: null
guide_doc: "v1.4 §Build 14g"
plan_file: null
handoff: null
related: ["[[build-14d]]", "[[build-17c]]"]
---

#status/shipped #area/settings #area/notifications #build/14g

## What shipped

In-app notifications system with bell icon in the nav and per-user preferences. Later extended by [[build-17c]] to fan out payment-event writes to admins.

- **Migration:** [supabase/migration-build14g.sql](../../../supabase/migration-build14g.sql) — `notifications`, `notification_preferences`.
- **Routes:** `/settings/notifications`, `/api/notifications`.
- **Component:** [src/components/notification-bell.tsx](../../../src/components/notification-bell.tsx).

## Source

- Commit: `35cf86d Build 14g: Notifications bell, preferences, and auth fixes`
- Migration: [supabase/migration-build14g.sql](../../../supabase/migration-build14g.sql)
- Guide: v1.4 §Build 14g
