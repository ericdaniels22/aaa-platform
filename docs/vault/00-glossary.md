# Glossary

Names, terms, and shorthand that recur across Nookleus work. New terms get added the moment they're coined. Format: **bolded term** — definition.

## Product and identity

- **Nookleus** — product name, locked 2026-04-21 as the rebrand of `aaa-platform`. iOS-first rollout is done; web still shows "AAA Disaster Recovery" until a separate-domain decision is made.
- **AAA Disaster Recovery** — first tenant org in the multi-tenant system; doubles as the public-facing brand on web until the Nookleus rollout reaches the web layer.
- **aaa-platform** — original repo name, still the GitHub repo slug at `github.com/ericdaniels22/aaa-platform`.

## Machines and environments

- **TheLaunchPad** — Eric's primary Windows dev machine. _(Note: earlier spec drafts described this as a borrowed Mac. Current reality is Windows; the Mac used for iOS work is referenced separately as "the Mac.")_
- **The Mac** — used for iOS / Xcode work. Access is intermittent, hence the recurring "Mac access" thread.

## Platform features

- **Jarvis** — Nookleus's in-platform AI assistant. **Shipped** at `/jarvis` and `/api/jarvis`, with the knowledge base at `/settings/knowledge`. Backed by migrations 21, 25a, 27, 28. Embeds the Claude API with full job context.
- **Knowledge base** — Jarvis's RAG-style knowledge store at `/settings/knowledge`.
- **Marketing module** — `/marketing` route + migration 23. An ad-hoc addition that is **not in any build guide doc**.

## Multi-tenant infrastructure

- **18a / 18b / 18c** — multi-tenant SaaS rollout. 18a schema + backfill, 18b RLS enforcement, 18c workspace switcher. All shipped (migrations 42–63).
- **Build 64** — restoration of the `handle_new_user` trigger that 18b accidentally dropped.

## Mobile (Build 65 series)

- **Build 65a** — Capacitor iOS shell. Shipped to TestFlight as Nookleus.
- **Build 65b** — camera UI (queued).
- **Build 65c** — upload pipeline (queued).
- **Build 65d** — mobile audit (queued).
- **Build 65e** — App Store submission (queued).

## Lessons and gotchas

- **build52 lesson** — GoTrue panics on NULL token columns in `auth.users`. Use empty strings instead, never NULL.

## Process and tooling

- **superpowers** — internal name for the planning / handoff document discipline. Lives in `docs/superpowers/`.
- **Vault** — this folder, `docs/vault/`. Curated knowledge content. Stood up in Build 66a; populated by Build 66b; maintained by Build 66c skills.
- **Build guide docs are incomplete.** The four `.docx` files (v1.3, v1.4, v1.6, v1.7) cover specs through Build 17 only. Builds 18, 21, 23, 25a, 27, 28, 29, 30, 31, 64, 65 shipped without ever being written into a guide doc. **The repo is the only source of truth for what shipped.**
- **Rule C finding** — established triage rule: minor finding → log + proceed; material finding → stop + hand back.
