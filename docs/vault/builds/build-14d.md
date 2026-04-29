---
build_id: 14d
title: User auth, login, crew & permissions
status: shipped
phase: settings
started: null
shipped: null
guide_doc: "v1.4 §Build 14d"
plan_file: null
handoff: null
related: ["[[build-14a]]", "[[build-18a]]", "[[build-64]]"]
---

#status/shipped #area/settings #area/auth #build/14d

## What shipped

Supabase Auth wired up: `/login` page, password auth, session via cookies, user profile mirror, crew management, role-based permissions.

- **Migration:** [supabase/migration-build14d.sql](../../../supabase/migration-build14d.sql) — `user_profiles`, `user_permissions`, `set_default_permissions()` function, `handle_new_user()` trigger.
- **Routes:** `/login`, `/logout`, `/settings/users`, `/api/settings/users`, `/api/settings/users/[id]`.
- **Roles:** admin, crew_lead, crew_member (later: custom).
- The `handle_new_user()` trigger and permissions system are foundational — they get rewritten/restored repeatedly later: [[build-18a]] (build48 rewrite), [[build-64]] (trigger restoration).

## Source

- Commit: `5816f1d Build 14d: User auth, login, crew management, and permissions`
- Migration: [supabase/migration-build14d.sql](../../../supabase/migration-build14d.sql)
- Guide: v1.4 §Build 14d
