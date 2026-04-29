---
skill: knowledge-search
status: shipped
location: src/app/api/knowledge/search, supabase function search_knowledge_chunks
related_agents: ["[[jarvis]]"]
related_builds: ["[[build-25a]]"]
---

#platform-skill #area/jarvis #area/knowledge #status/shipped

# `knowledge-search`

Pgvector-backed RAG search over uploaded restoration standards.

## How it works

1. The query string is embedded via Voyage AI (`voyage-3.5-lite`, 1024 dimensions, `inputType: "query"`).
2. A pgvector cosine similarity search runs against `knowledge_chunks.embedding` via the SQL RPC `search_knowledge_chunks(query_embedding, match_count, filter_document_id)`.
3. The HNSW index `idx_knowledge_chunks_embedding using hnsw (embedding vector_cosine_ops)` keeps lookup fast.

Each result includes `id`, `document_id`, `content`, `section_number`, `section_title`, `page_number`, `chunk_index`, `similarity`.

## Surfaces

- **API:** `/api/knowledge/search` (POST `{ query, limit }`) — returns top-N chunks.
- **Field Ops tool:** `search_knowledge_base` calls the same RPC from inside the Field Ops agent's tool loop.
- **Test UI:** `/settings/knowledge` Test Search section — admins paste a query and see relevance scores.

## Source

- Migration: [supabase/migration-build25a-knowledge.sql](../../../supabase/migration-build25a-knowledge.sql)
- Build: [[build-25a]]
- Embedding helper: [src/lib/knowledge/embeddings.ts](../../../src/lib/knowledge/embeddings.ts)
