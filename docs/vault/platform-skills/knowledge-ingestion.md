---
skill: knowledge-ingestion
status: shipped
location: src/lib/knowledge/chunking.ts, src/lib/knowledge/embeddings.ts, src/app/api/knowledge/ingest
related_agents: ["[[jarvis]]"]
related_builds: ["[[build-25a]]"]
---

#platform-skill #area/jarvis #area/knowledge #status/shipped

# `knowledge-ingestion`

Pipeline that turns an uploaded PDF/DOCX into vectorized, searchable chunks for [[knowledge-search]].

## Pipeline

1. **Upload** — `/api/knowledge/ingest` accepts `multipart/form-data` (`file`, `name`, `standard_id`, optional `description`). File saved to Storage; `knowledge_documents` row created with `status: 'processing'`.
2. **Parse** — `pdf.js-extract` for PDFs (DOCX support similar). Page-aware text extraction.
3. **Chunk** — [src/lib/knowledge/chunking.ts](../../../src/lib/knowledge/chunking.ts). Section-aware splitting: regex patterns recognize numbered sections (`12.3.10 Title`), `Section N` headers, appendix `A.1 Title`, and `CHAPTER N: Title`. Hard cap `MAX_CHUNK_TOKENS = 800` (rough estimate ~4 chars/token).
4. **Embed** — [src/lib/knowledge/embeddings.ts](../../../src/lib/knowledge/embeddings.ts). Voyage AI `voyage-3.5-lite` (1024-d), `BATCH_SIZE = 2` for free-tier 10K TPM rate limit, retry-with-backoff up to 5 attempts.
5. **Store** — `knowledge_chunks` rows inserted with `embedding vector(1024)`, plus section metadata (`section_number`, `section_title`, `page_number`, `chunk_index`, `token_count`).
6. **Status flip** — `knowledge_documents.status` → `'ready'` (or `'error'` with detail). UI polls `/api/knowledge/documents` every 3s while any document is processing.

## Required env

- `VOYAGE_API_KEY` — Voyage AI key for the embedding API.

## Source

- Migration: [supabase/migration-build25a-knowledge.sql](../../../supabase/migration-build25a-knowledge.sql)
- Build: [[build-25a]]
- Routes: `/api/knowledge/ingest`, `/api/knowledge/documents`, `/api/knowledge/documents/[id]`
- UI: [src/app/settings/knowledge/page.tsx](../../../src/app/settings/knowledge/page.tsx)
