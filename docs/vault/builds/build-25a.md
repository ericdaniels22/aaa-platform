---
build_id: 25a
title: RAG knowledge base + Field Operations agent
status: shipped
phase: jarvis-ecosystem
started: null
shipped: null
guide_doc: null
plan_file: null
handoff: null
related: ["[[build-21]]", "[[build-23]]", "[[build-26b]]", "[[jarvis]]", "[[knowledge-search]]", "[[knowledge-ingestion]]"]
---

#status/shipped #area/jarvis #area/knowledge #build/25a

## What shipped

RAG knowledge base infrastructure (pgvector + Field Ops specialist agent that consults it). Bundled with Build 2.4 (Field Operations agent) and Build 2.5b in commit `45be1a6`.

- **Migration:** [supabase/migration-build25a-knowledge.sql](../../../supabase/migration-build25a-knowledge.sql) — enables `pgvector` extension, creates `knowledge_documents`, `knowledge_chunks` (with `vector(1024)` embeddings), HNSW cosine index, `search_knowledge_chunks(query_embedding, match_count, filter_document_id)` RPC.
- **Routes:** `/settings/knowledge` (admin RAG ingestion UI), `/api/knowledge/documents`, `/api/knowledge/documents/[id]`, `/api/knowledge/ingest`, `/api/knowledge/search`, `/api/jarvis/field-ops` (Field Operations agent endpoint).
- **Library:** [src/lib/knowledge/chunking.ts](../../../src/lib/knowledge/chunking.ts), [src/lib/knowledge/embeddings.ts](../../../src/lib/knowledge/embeddings.ts), `pdf.js-extract` for PDF parsing.
- **Field Ops tools:** `get_job_context`, `get_moisture_readings`, `get_safety_alerts`, `search_knowledge_base`. Knowledge sources include S500 (Water), S520 (Mold), S700 reference standards plus full standards via pgvector.
- **System prompt:** [src/lib/jarvis/prompts/field-ops.ts](../../../src/lib/jarvis/prompts/field-ops.ts).

## Source

- Commit: `45be1a6 feat: Build 2.5a + 2.5b + 2.4 — RAG knowledge base and Field Operations agent`
- Migration: [supabase/migration-build25a-knowledge.sql](../../../supabase/migration-build25a-knowledge.sql)
- Guide: none
