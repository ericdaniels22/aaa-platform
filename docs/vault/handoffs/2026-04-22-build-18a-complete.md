---
date: 2026-04-22
build: 18a
session: complete
status: shipped
---

#area/multi-tenant #build/18a #status/shipped

# Build 18a — Complete handoff (post-prod-apply)

All 11 schema migrations (build42–build52) applied to prod `rzzprgidqbnqcdupmpfe` on 2026-04-22. Smoke check passes on prod. Branch had the orphan-fallback patch + 3 blocker fixes from rehearsal.

Multi-tenant schema is now live: organizations + memberships + per-org `organization_id` columns + transitional allow-all RLS policies. Next mainline of work was [[build-18b]] (RLS enforcement).

This handoff supersedes the rehearsal-stage [[2026-04-22-build-18a-progress]].

## Source

- Original document: [docs/build-18a-complete-handoff.md](../../../docs/build-18a-complete-handoff.md)
- Build card: [[build-18a]]
- Plan: [docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md](../../../docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md)
- Commit: `1b4004c Build 18a complete — all migrations applied to production, handoff doc for next session`
